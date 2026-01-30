import Order from '#models/order'
import User from '#models/user'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import emitter from '@adonisjs/core/services/emitter'
import MissionOffered from '#events/mission_offered'
import RedisService, { CondensedDriverState } from '#services/redis_service'
import redis from '@adonisjs/redis/services/main'

@inject()
export default class DispatchService {
    private readonly REJECTION_PREFIX = 'sublymus:order:rejections:'

    /**
     * Main entry point to dispatch an order based on its assignment mode.
     */
    async dispatch(order: Order) {
        logger.info({ orderId: order.id, mode: order.assignmentMode, refId: order.refId }, 'Starting dispatch process')

        // S'assurer que la commande est toujours PENDING
        if (order.status !== 'PENDING') {
            logger.warn({ orderId: order.id, status: order.status }, 'Dispatch aborted: Order is not PENDING')
            return
        }

        // Vérifier si une offre est déjà en cours
        if (order.offeredDriverId && order.offerExpiresAt && order.offerExpiresAt > DateTime.now()) {
            logger.debug({ orderId: order.id, offeredTo: order.offeredDriverId }, 'Dispatch skipped: Active offer exists')
            return
        }

        switch (order.assignmentMode) {
            case 'TARGET':
                await this.handleTargetDispatch(order)
                break
            case 'INTERNAL':
                await this.handleInternalDispatch(order)
                break
            case 'GLOBAL':
            default:
                await this.handleGlobalDispatch(order)
                break
        }
    }

    /**
     * Dispatch to a specific target (Driver or Company) via Ref-ID.
     */
    private async handleTargetDispatch(order: Order) {
        if (!order.refId) {
            logger.warn({ orderId: order.id }, 'Target dispatch failed: No refId. Falling back to Global.')
            return this.handleGlobalDispatch(order)
        }

        // 1. Essayer de trouver un chauffeur par son ID (liv_XXXX ou NanoID)
        const driver = await User.query()
            .where('id', order.refId)
            .where('isDriver', true)
            .first()

        if (driver) {
            const state = await RedisService.getDriverState(driver.id)
            if (state && state.status === 'ONLINE') {
                logger.info({ orderId: order.id, driverId: driver.id }, 'Target dispatch: Found specific driver')
                return this.offerToDriver(order, driver.id)
            }
        }

        // 2. Si non trouvé ou non dispo, est-ce une entreprise ?
        const Company = (await import('#models/company')).default
        const company = await Company.find(order.refId)
        if (company) {
            logger.info({ orderId: order.id, companyId: company.id }, 'Target dispatch: Found company, treating as INTERNAL')
            return this.handleInternalDispatch(order, company.id)
        }

        logger.warn({ orderId: order.id, refId: order.refId }, 'Target dispatch failed: No valid target. Falling back.')
        // Note: Si c'était une commande "obligatoire" pour cet acteur, on ne devrait peut-être pas fallback.
        // Mais pour l'instant on garde le fallback global.
        return this.handleGlobalDispatch(order)
    }

    /**
     * Dispatch to a company fleet.
     * @param forcedCompanyId If provided, ignore order client's company
     */
    private async handleInternalDispatch(order: Order, forcedCompanyId?: string) {
        let companyId = forcedCompanyId
        if (!companyId) {
            await order.load('client')
            companyId = (order.client as any).effectiveCompanyId || undefined
        }

        if (!companyId) {
            logger.error({ orderId: order.id }, 'INTERNAL dispatch requires company context')
            order.status = 'NO_DRIVER_AVAILABLE'
            await order.save()
            throw new Error('INTERNAL dispatch requires company context')
        }

        // Trouver les drivers de l'entreprise qui sont ONLINE dans Redis
        // On récupère d'abord les rejets pour cet ordre
        const rejections = await this.getRejections(order.id)

        // On peut faire un join SQL ou filtrer les états Redis. 
        // Pour la performance, on va chercher en base les drivers de la boite et croiser avec Redis.
        const drivers = await User.query()
            .where('companyId', companyId)
            .where('isDriver', true)
            .whereNotIn('id', rejections)

        for (const driver of drivers) {
            const state = await RedisService.getDriverState(driver.id)
            if (state && state.status === 'ONLINE' && state.active_company_id === companyId) {
                logger.info({ orderId: order.id, driverId: driver.id }, 'Internal dispatch: Best candidate found')
                return this.offerToDriver(order, driver.id)
            }
        }

        logger.warn({ orderId: order.id, companyId }, 'INTERNAL dispatch: No drivers available in company fleet')
        order.status = 'NO_DRIVER_AVAILABLE'
        await order.save()
        // TODO: Notify client that no driver is available
        // Ne bascule PAS en global automatiquement pour "INTERNE" (règle métier stricte)
    }

    /**
     * Dispatch to the global pool using Geo-search.
     */
    private async handleGlobalDispatch(order: Order) {
        // 1. Charger l'adresse de collecte
        await order.load('pickupAddress')
        const pickup = order.pickupAddress

        if (!pickup) {
            logger.error({ orderId: order.id }, 'Global dispatch failed: No pickup address')
            return
        }

        // 2. Récupérer les drivers exclus (rejets)
        const rejections = await this.getRejections(order.id)

        // 3. Geo-search Redis (ex: rayon de 10km)
        const nearbyDrivers = await RedisService.findDriversNearby(pickup.lng, pickup.lat, 10)

        // --- Phase 1: Chercher un driver ONLINE ---
        for (const candidate of nearbyDrivers) {
            if (rejections.includes(candidate.id)) continue

            const state = await RedisService.getDriverState(candidate.id)

            // Critères : ONLINE et acceptant les ordres globaux
            if (state && state.status === 'ONLINE') {
                logger.info({ orderId: order.id, driverId: candidate.id, dist: candidate.distance }, 'Global dispatch: Found nearby ONLINE driver')
                return this.offerToDriver(order, candidate.id)
            }
        }

        // --- Phase 2: Chaînage - Chercher un driver BUSY éligible ---
        // On cherche des drivers dont la prochaine destination est proche du pickup
        logger.debug({ orderId: order.id }, 'No ONLINE drivers, checking for chaining candidates...')

        const allDriverStates = await this.getAllBusyDriverStates()
        const CHAINING_RADIUS_KM = 1 // Rayon max entre destination actuelle et nouveau pickup

        for (const state of allDriverStates) {
            if (rejections.includes(state.id)) continue

            // Vérifier l'éligibilité au chaînage
            if (!RedisService.canAcceptChainedMission(state)) continue

            // Vérifier la proximité de la destination avec le pickup
            if (state.next_destination) {
                const distanceToPickup = this.haversineDistance(
                    state.next_destination.lat, state.next_destination.lng,
                    pickup.lat, pickup.lng
                )

                if (distanceToPickup <= CHAINING_RADIUS_KM) {
                    logger.info({
                        orderId: order.id,
                        driverId: state.id,
                        distanceToPickup,
                        currentOrders: state.current_orders.length
                    }, 'Global dispatch: Found BUSY driver eligible for chaining')
                    return this.offerToDriver(order, state.id)
                }
            }
        }

        logger.info({ orderId: order.id }, 'Global dispatch: No drivers found (ONLINE or chaining).')
    }

    /**
     * Récupère tous les états de drivers BUSY depuis Redis.
     * 
     * TODO [CHAINING EVOLUTION]:
     * Pour des performances optimales avec beaucoup de drivers, envisager:
     * - Un second Geo-index Redis indexant les next_destination des drivers BUSY
     * - Ou un SCAN Redis avec pattern matching sur les clés d'état
     */
    private async getAllBusyDriverStates(): Promise<CondensedDriverState[]> {
        // Pour l'instant, approche simple avec SCAN Redis
        // En production avec beaucoup de drivers, optimiser avec un index dédié
        const DriverSetting = (await import('#models/driver_setting')).default
        const drivers = await DriverSetting.query().where('status', 'BUSY')

        const states: CondensedDriverState[] = []
        for (const driver of drivers) {
            const state = await RedisService.getDriverState(driver.userId)
            if (state && state.status === 'BUSY') {
                states.push(state)
            }
        }
        return states
    }

    /**
     * Calcule la distance entre deux points en km (formule de Haversine).
     */
    private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const R = 6371 // Rayon de la Terre en km
        const dLat = (lat2 - lat1) * Math.PI / 180
        const dLng = (lng2 - lng1) * Math.PI / 180
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
    }

    /**
     * Register a rejection for an order.
     */
    async registerRejection(orderId: string, driverId: string) {
        const key = `${this.REJECTION_PREFIX}${orderId}`
        await redis.sadd(key, driverId)
        await redis.expire(key, 3600) // TTL 1h
    }

    /**
     * Get list of drivers who rejected this order.
     */
    private async getRejections(orderId: string): Promise<string[]> {
        const key = `${this.REJECTION_PREFIX}${orderId}`
        return await redis.smembers(key)
    }

    /**
     * Offer the order to a specific driver.
     */
    private async offerToDriver(order: Order, driverId: string) {
        // Durée de l'offre basée sur la priorité
        const timeoutSeconds = order.priority === 'HIGH' ? 60 : 180 // 1 min vs 3 min

        // 1. Verrouiller le chauffeur dans Redis immédiatement pour éviter les doubles offres
        const state = await RedisService.getDriverState(driverId)
        if (!state || state.status !== 'ONLINE') {
            logger.warn({ orderId: order.id, driverId }, 'Offer aborted: Driver is no longer ONLINE')
            return
        }

        // 2. Mettre à jour l'ordre
        order.offeredDriverId = driverId
        order.offerExpiresAt = DateTime.now().plus({ seconds: timeoutSeconds })
        order.assignmentAttemptCount++
        await order.save()

        // 3. Mettre à jour le statut du chauffeur à OFFERING dans Redis
        // Note: On ne touche pas à current_orders car l'offre n'est pas encore acceptée
        await RedisService.updateDriverState(driverId, { status: 'OFFERING' })

        emitter.emit(MissionOffered, new MissionOffered({
            orderId: order.id,
            driverId: driverId,
            expiresAt: order.offerExpiresAt.toISO()!
        }))

        logger.info({ orderId: order.id, driverId, expiresAt: order.offerExpiresAt.toISO() }, 'Order offered to driver')
    }
}
