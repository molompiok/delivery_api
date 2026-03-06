import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'
import Order from '#models/order'
import Step from '#models/step'
import Stop from '#models/stop'
import Action from '#models/action'
import ActionProof from '#models/action_proof'
import OrderLeg from '#models/order_leg'
import PricingFilter from '#models/pricing_filter'
import Zone from '#models/zone'
import GeoService from '#services/geo_service'
import PricingFilterService, { StopPriceInput } from '#services/pricing_filter_service'
import PaymentPolicyService from '#services/payment_policy_service'
import OrderPaymentService from '#services/order_payment_service'
import subscriptionService from '#services/subscription_service'
import { SimplePackageInfo } from '#services/pricing_service'
import OrderStatusUpdated from '#events/order_status_updated'
import DispatchService from '#services/dispatch_service'
import LogisticsService from '#services/logistics_service'
import { inject } from '@adonisjs/core'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { OrderTemplate } from '#constants/order_templates'
import ActionService from './action_service.js'
import TransitItem from '#models/transit_item'
import User from '#models/user'
import Company from '#models/company'
import OrToolsService, { OrToolsStop, OrToolsAction } from '../optimizer/or_tools_service.js'
import redis from '@adonisjs/redis/services/main'
import wsService from '#services/ws_service'


const COCODY = [-3.989, 5.348] as [number, number]
/**
 * ARCHITECTURE NOTE: Smart Recalculation & Deviation Handling
 * ---------------------------------------------------------
 * To optimize server load and battery life, we avoid recalculating the route on every GPS ping.
 * 
 * STRATEGY:
 * 1. The Mobile App (delivery_app_driver) monitors its 'Cross-track distance' relative to the path
 *    received from getRoute().
 * 2. If the App detects a deviation > 100 meters, it triggers POST /orders/:id/recalculate.
 * 3. The Server then forces a fresh OR-Tools/Valhalla call bypassing the cache.
 */
@inject()
export default class OrderDraftService {
    constructor(
        protected dispatchService: DispatchService,
        protected actionService: ActionService,
        protected orToolsService: OrToolsService
    ) { }

    private assertTemplateAllowedForCompanyActivity(company: Company, template: string, context: 'INTERNAL' | 'TARGET') {
        const activityType = String(company.activityType || '').toUpperCase()
        const normalizedTemplate = String(template || '').toUpperCase()

        // Regime rule: COMMANDE companies cannot create MISSION/VOYAGE orders.
        if (activityType === 'COMMANDE' && ['MISSION', 'VOYAGE'].includes(normalizedTemplate)) {
            throw new Error(
                `E_ACTIVITY_TEMPLATE_FORBIDDEN: company ${company.id} activityType=COMMANDE cannot create template=${normalizedTemplate} in ${context} mode. Allowed template: COMMANDE.`
            )
        }
    }

    private async assertSubscriptionAccessForCompany(
        companyId: string | null,
        trx: TransactionClientContract,
        context: string,
        preloadedCompany?: Company | null
    ) {
        if (!companyId) return
        const company =
            preloadedCompany ||
            await Company.query({ client: trx })
                .where('id', companyId)
                .select('id', 'settings')
                .first()

        const rawSettings = (company as any)?.settings
        const settings =
            typeof rawSettings === 'string'
                ? (() => {
                    try { return JSON.parse(rawSettings) } catch { return {} }
                })()
                : (rawSettings || {})
        const graceDaysRaw = Number(settings?.subscriptionGraceDays ?? 7)
        const graceDays = Number.isFinite(graceDaysRaw) ? Math.max(0, Math.floor(graceDaysRaw)) : 7
        await subscriptionService.assertCompanyCanConsume(companyId, trx, { graceDays, context })
    }

    /**
     * Reconstructs the VROOM-like route object from DB Legs + Stops.
     * Used for LIVE route fetching without recalculation.
     */
    private async buildLiveRouteFromDB(order: Order, trx?: TransactionClientContract): Promise<any> {
        // Ensure leg is loaded via the provided transaction
        if (!order.leg) {
            await order.load('leg', (q) => {
                if (trx) q.useTransaction(trx)
            })
        }

        // If no leg found (e.g. legacy or broken state), fallback to null or empty
        if (!order.leg) return null

        // 1. Reconstruct Geometry (Single Leg)
        const leg = order.leg
        const actualCoordinates = leg.actualPath?.coordinates || []
        const estimatedCoordinates = leg.geometry?.coordinates || []

        // Full geometry is Past + Future
        const fullCoordinates = [...actualCoordinates, ...estimatedCoordinates]

        if (fullCoordinates.length === 0 && leg.startCoordinates && leg.endCoordinates) {
            // Fallback
            fullCoordinates.push(leg.startCoordinates.coordinates)
            fullCoordinates.push(leg.endCoordinates.coordinates)
        }

        // 2. Reconstruct Stops
        const allStops = order.steps.flatMap(s => s.stops)

        // Sort by executionOrder (OR-Tools), fallback to displayOrder (client)
        allStops.sort((a, b) => (a.executionOrder ?? a.displayOrder) - (b.executionOrder ?? b.displayOrder))

        const optimizedStops = allStops.map((stop, index) => {
            const defaultVal = index === 0 ? 0 : null
            const meta = stop.metadata || {}
            const routeInfo = meta.route_info || {}

            const arrival = routeInfo.arrival_offset ?? defaultVal ?? 0
            const dist = routeInfo.distance_from_start ?? defaultVal ?? 0

            return {
                stopId: stop.id,
                execution_order: stop.executionOrder ?? index,
                display_order: stop.displayOrder,
                status: stop.status,
                arrival: arrival,
                arrival_time: this.formatSecondsToHm(arrival),
                duration: arrival,
                distance: dist
            }
        })

        return {
            summary: {
                total_distance: leg.distanceMeters || 0,
                total_duration: leg.durationSeconds || 0
            },
            geometry: {
                type: 'LineString',
                coordinates: estimatedCoordinates
            },
            actual_history: {
                type: 'LineString',
                coordinates: actualCoordinates
            },
            full_geometry: {
                type: 'LineString',
                coordinates: fullCoordinates
            },
            stops: optimizedStops,
            raw: {}
        }
    }

    /**
     * Helper to get driver's current location from Redis.
     */
    private async getDriverStartLocation(driverId?: string | null): Promise<[number, number] | undefined> {
        if (!driverId) return undefined
        try {
            const RedisService = (await import('#services/redis_service')).default
            const state = await RedisService.getDriverState(driverId)
            if (state && state.last_lat && state.last_lng) {
                return [state.last_lng, state.last_lat]
            }
        } catch (error) {
            logger.error({ driverId, err: error }, 'Error fetching driver start location')
        }
        return undefined
    }

    private toNumberOrZero(value: any): number {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : 0
    }

    private getStopCoordinates(stop: any): { lat: number, lng: number } | null {
        const lat = Number(stop?.address?.lat)
        const lng = Number(stop?.address?.lng)
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng }
        }

        if (Array.isArray(stop?.coordinates) && stop.coordinates.length === 2) {
            const lngCoord = Number(stop.coordinates[0])
            const latCoord = Number(stop.coordinates[1])
            if (Number.isFinite(latCoord) && Number.isFinite(lngCoord)) {
                return { lat: latCoord, lng: lngCoord }
            }
        }

        return null
    }

    private getTransitItemVolumeM3(transitItem: any): number {
        if (!transitItem) return 0
        const dimensions = transitItem.dimensions || transitItem.dimension || {}
        const explicitM3 = Number(dimensions.volume_m3 ?? dimensions.volumeM3)
        if (Number.isFinite(explicitM3) && explicitM3 > 0) return explicitM3

        const liters = Number(dimensions.volume_l ?? dimensions.volumeL)
        if (Number.isFinite(liters) && liters > 0) return liters / 1000

        const w = Number(dimensions.width_cm ?? dimensions.widthCm)
        const h = Number(dimensions.height_cm ?? dimensions.heightCm)
        const d = Number(dimensions.depth_cm ?? dimensions.depthCm)
        if ([w, h, d].every((n) => Number.isFinite(n) && n > 0)) {
            return (w * h * d) / 1_000_000
        }
        return 0
    }

    private getDeliveryLoadForStop(stop: any): { weightKg: number, volumeM3: number, isFragile: boolean } {
        const actions: any[] = Array.isArray(stop?.actions) ? stop.actions : []
        let weightKg = 0
        let volumeM3 = 0
        let isFragile = false

        for (const action of actions) {
            if (String(action?.type || '').toUpperCase() !== 'DELIVERY') continue

            const quantity = Math.max(0, this.toNumberOrZero(action?.quantity) || 0)
            const multiplier = quantity > 0 ? quantity : 1
            const transitItem = action?.transitItem || action?.transit_item || null

            const unitWeight = this.toNumberOrZero(transitItem?.weight)
            const unitVolume = this.getTransitItemVolumeM3(transitItem)
            weightKg += unitWeight * multiplier
            volumeM3 += unitVolume * multiplier

            const metadata = transitItem?.metadata || {}
            const requirements = Array.isArray(metadata?.requirements) ? metadata.requirements : []
            const hasFragileReq = requirements.some((r: any) => String(r).toLowerCase() === 'fragile')
            if (metadata?.fragile === true || hasFragileReq) {
                isFragile = true
            }
        }

        return { weightKg, volumeM3, isFragile }
    }

    private haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const toRad = (deg: number) => (deg * Math.PI) / 180
        const r = 6371
        const dLat = toRad(lat2 - lat1)
        const dLng = toRad(lng2 - lng1)
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return r * c
    }

    private isPointInPolygon(lat: number, lng: number, paths: Array<{ lat: number, lng: number }>): boolean {
        if (!Array.isArray(paths) || paths.length < 3) return false

        let inside = false
        const x = lng
        const y = lat

        for (let i = 0, j = paths.length - 1; i < paths.length; j = i++) {
            const xi = Number(paths[i]?.lng)
            const yi = Number(paths[i]?.lat)
            const xj = Number(paths[j]?.lng)
            const yj = Number(paths[j]?.lat)
            if (![xi, yi, xj, yj].every(Number.isFinite)) continue

            const intersects = ((yi > y) !== (yj > y))
                && (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi)
            if (intersects) inside = !inside
        }

        return inside
    }

    private zoneContainsPoint(zone: Zone, lat: number, lng: number): boolean {
        const type = String(zone.type || '').toLowerCase()
        const geometry = zone.geometry || {}

        if (type === 'circle') {
            const centerLat = Number(geometry?.center?.lat)
            const centerLng = Number(geometry?.center?.lng)
            const radiusKm = Number(geometry?.radiusKm)
            if (![centerLat, centerLng, radiusKm].every(Number.isFinite)) return false
            return this.haversineDistanceKm(lat, lng, centerLat, centerLng) <= radiusKm
        }

        if (type === 'rectangle') {
            const north = Number(geometry?.bounds?.north)
            const south = Number(geometry?.bounds?.south)
            const east = Number(geometry?.bounds?.east)
            const west = Number(geometry?.bounds?.west)
            if (![north, south, east, west].every(Number.isFinite)) return false
            return lat <= north && lat >= south && lng <= east && lng >= west
        }

        if (type === 'polygon') {
            const paths = Array.isArray(geometry?.paths) ? geometry.paths : []
            return this.isPointInPolygon(lat, lng, paths)
        }

        return false
    }

    private extractZoneMatrixPairs(zoneMatrix: any): Array<{ fromZoneId: string, toZoneId: string, basePrice: number, bidirectional: boolean }> {
        const pairs = Array.isArray(zoneMatrix?.pairs) ? zoneMatrix.pairs : []
        const normalized: Array<{ fromZoneId: string, toZoneId: string, basePrice: number, bidirectional: boolean }> = []
        const seen = new Set<string>()

        for (const pair of pairs) {
            const fromZoneId = String(pair?.fromZoneId || '').trim()
            const toZoneId = String(pair?.toZoneId || '').trim()
            const basePrice = Number(pair?.basePrice)
            const bidirectional = pair?.bidirectional === true
            if (!fromZoneId || !toZoneId || !Number.isFinite(basePrice) || basePrice < 0) continue

            const key = `${fromZoneId}->${toZoneId}`
            if (seen.has(key)) continue
            seen.add(key)
            normalized.push({ fromZoneId, toZoneId, basePrice: Math.round(basePrice), bidirectional })
        }

        return normalized
    }

    private resolveZoneMatrixPair(
        pairs: Array<{ fromZoneId: string, toZoneId: string, basePrice: number, bidirectional: boolean }>,
        fromZoneId: string,
        toZoneId: string
    ): { basePrice: number, matrixPairKey: string } | null {
        const exact = pairs.find((p) => p.fromZoneId === fromZoneId && p.toZoneId === toZoneId)
        if (exact) {
            return { basePrice: exact.basePrice, matrixPairKey: `${exact.fromZoneId}->${exact.toZoneId}` }
        }

        const reverse = pairs.find((p) => p.fromZoneId === toZoneId && p.toZoneId === fromZoneId && p.bidirectional)
        if (reverse) {
            return { basePrice: reverse.basePrice, matrixPairKey: `${reverse.fromZoneId}->${reverse.toZoneId}:BIDIRECTIONAL` }
        }

        return null
    }

    private resolveZoneForPoint(
        zonesById: Map<string, Zone>,
        orderedZoneIds: string[],
        point: { lat: number, lng: number } | null
    ): string | null {
        if (!point) return null
        for (const zoneId of orderedZoneIds) {
            const zone = zonesById.get(zoneId)
            if (!zone) continue
            if (this.zoneContainsPoint(zone, point.lat, point.lng)) return zoneId
        }
        return null
    }

    private async buildStopPriceInputs(
        orderTemplate: string | null | undefined,
        filter: PricingFilter,
        stops: any[],
        routeLegs: any[] | undefined,
        trx?: TransactionClientContract
    ): Promise<StopPriceInput[]> {
        const normalizedTemplate = String(orderTemplate || '').toUpperCase()
        const stopPriceInputs: StopPriceInput[] = []

        let orderedZoneIds: string[] = []
        let zonesById = new Map<string, Zone>()
        let zonePairs: Array<{ fromZoneId: string, toZoneId: string, basePrice: number, bidirectional: boolean }> = []

        if (normalizedTemplate === 'COMMANDE' && filter.zoneMatrixEnabled) {
            zonePairs = this.extractZoneMatrixPairs(filter.zoneMatrix)
            if (zonePairs.length > 0) {
                orderedZoneIds = Array.from(new Set(zonePairs.flatMap((p) => [p.fromZoneId, p.toZoneId])))
                const zones = await Zone.query({ client: trx })
                    .whereIn('id', orderedZoneIds)
                    .where('is_active', true)
                zonesById = new Map(zones.map((z) => [z.id, z]))
            }
        }

        for (let index = 0; index < stops.length; index++) {
            const stop = stops[index]
            const { weightKg, volumeM3, isFragile } = this.getDeliveryLoadForStop(stop)
            const routeLeg = index > 0 ? routeLegs?.[index] : null
            const distanceKm = index > 0 ? this.toNumberOrZero(routeLeg?.distance_meters) / 1000 : 0
            const durationSeconds = index > 0 ? this.toNumberOrZero(routeLeg?.duration_seconds) : 0
            const stopMeta = stop?.metadata || {}
            const hasManualOverride = stopMeta?.price_override?.is_active === true

            const input: StopPriceInput = {
                template: normalizedTemplate,
                distanceKm,
                durationSeconds,
                prevStopDistanceKm: distanceKm,
                weightKg,
                volumeM3,
                isFragile,
                overrideAmount: hasManualOverride ? this.toNumberOrZero(stopMeta.price_override.amount) : undefined,
            }

            if (normalizedTemplate === 'COMMANDE' && index === 0) {
                input.overrideAmount = 0
            }

            if (normalizedTemplate === 'COMMANDE' && index > 0 && orderedZoneIds.length > 0 && zonePairs.length > 0) {
                const fromPoint = this.getStopCoordinates(stops[index - 1])
                const toPoint = this.getStopCoordinates(stop)
                const fromZoneId = this.resolveZoneForPoint(zonesById, orderedZoneIds, fromPoint)
                const toZoneId = this.resolveZoneForPoint(zonesById, orderedZoneIds, toPoint)

                if (fromZoneId && toZoneId) {
                    const pair = this.resolveZoneMatrixPair(zonePairs, fromZoneId, toZoneId)
                    if (pair) {
                        input.matrixBaseFee = pair.basePrice
                        input.matchedFromZoneId = fromZoneId
                        input.matchedToZoneId = toZoneId
                        input.matrixPairKey = pair.matrixPairKey
                    }
                }
            }

            stopPriceInputs.push(input)
        }

        return stopPriceInputs
    }

    /**
     * Initiates a new order in DRAFT status.
     */
    async initiateOrder(clientId: string, data: { template?: OrderTemplate } & any = {}, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()

        try {
            // Resolve company and driver defaults
            const user = await User.findOrFail(clientId, { client: effectiveTrx })
            await user.load('driverSetting', (q) => { if (effectiveTrx) q.useTransaction(effectiveTrx) })

            const ownedCompany = await Company.query({ client: effectiveTrx })
                .where('owner_id', clientId)
                .first()

            // Active manager context: currentCompanyManaged has priority over ownership.
            let company = ownedCompany
            if (user.currentCompanyManaged) {
                const managedCompany = await Company.query({ client: effectiveTrx })
                    .where('id', user.currentCompanyManaged)
                    .first()
                if (managedCompany) {
                    company = managedCompany
                }
            }
            // 1. Résolution du template par défaut
            // Hiérarchie : Préférence Driver > Préférence Company > Global Default ('COMMANDE')
            // Note : L'identité métier (activityType) de l'entreprise sert de base au defaultTemplate à la création.
            const defaultTemplate = user.driverSetting?.defaultTemplate || (company as any)?.defaultTemplate || 'COMMANDE'

            // 2. Le template final est soit celui précisé dans l'ordre, soit le défaut résolu
            const template = String(data.template || defaultTemplate || 'COMMANDE').toUpperCase()

            const assignmentMode = String(data.assignment_mode || data.assignmentMode || 'GLOBAL').toUpperCase()
            const targetCompanyIdFromPayload = data.targetCompanyId || data.target_company_id || null
            const targetDriverIdFromPayload = data.targetDriverId || data.target_driver_id || null
            const explicitRefId = data.ref_id || data.refId || null

            // TARGET contract: either company target OR driver target is required.
            if (assignmentMode === 'TARGET' && !targetCompanyIdFromPayload && !targetDriverIdFromPayload && !explicitRefId) {
                throw new Error('TARGET assignment requires either targetCompanyId or targetDriverId (or ref_id).')
            }

            let targetCompanyIdResolved: string | null = targetCompanyIdFromPayload
            let targetDriverIdResolved: string | null = targetDriverIdFromPayload

            // Resolve ref_id as company or driver target for TARGET mode.
            if (assignmentMode === 'TARGET' && explicitRefId) {
                const refCompany = await Company.query({ client: effectiveTrx }).where('id', explicitRefId).first()
                if (refCompany) {
                    targetCompanyIdResolved = refCompany.id
                } else {
                    const refDriver = await User.query({ client: effectiveTrx })
                        .where('id', explicitRefId)
                        .where('is_driver', true)
                        .select('id', 'company_id')
                        .first()
                    if (refDriver) {
                        targetDriverIdResolved = refDriver.id
                        targetCompanyIdResolved = refDriver.companyId || targetCompanyIdResolved
                    }
                }
            }

            if (assignmentMode === 'TARGET' && targetDriverIdResolved && !targetCompanyIdResolved) {
                const targetDriver = await User.query({ client: effectiveTrx })
                    .where('id', targetDriverIdResolved)
                    .where('is_driver', true)
                    .select('company_id')
                    .first()
                targetCompanyIdResolved = targetDriver?.companyId || null
            }

            if (assignmentMode === 'INTERNAL' && !company?.id) {
                throw new Error('INTERNAL assignment requires an active manager company context (owner or currentCompanyManaged).')
            }

            if (assignmentMode === 'INTERNAL' && company) {
                this.assertTemplateAllowedForCompanyActivity(company, template, 'INTERNAL')
            }

            let targetCompanyResolved: Company | null = null
            if (assignmentMode === 'TARGET' && targetCompanyIdResolved) {
                targetCompanyResolved = await Company.query({ client: effectiveTrx })
                    .where('id', targetCompanyIdResolved)
                    .first()

                if (targetCompanyResolved) {
                    this.assertTemplateAllowedForCompanyActivity(targetCompanyResolved, template, 'TARGET')
                }
            }

            // B2B verification is only required for TARGET + MISSION.
            if (assignmentMode === 'TARGET' && template === 'MISSION') {
                if (!targetCompanyIdResolved) {
                    throw new Error('TARGET + MISSION requires targetCompanyId (directly or resolved from target driver/ref).')
                }

                const targetCompanyQuery =
                    targetCompanyResolved ||
                    await Company.query({ client: effectiveTrx })
                        .where('id', targetCompanyIdResolved)
                        .first()

                if (!targetCompanyQuery) {
                    throw new Error(`Target company ${targetCompanyIdResolved} not found`)
                }

                const isManagerOfTarget =
                    targetCompanyQuery.ownerId === clientId || user.currentCompanyManaged === targetCompanyQuery.id

                if (!isManagerOfTarget) {
                    const isAuthorized = await db.from('company_b2b_partners')
                        .useTransaction(effectiveTrx)
                        .where('company_id', targetCompanyIdResolved)
                        .where('client_id', clientId)
                        .where('status', 'ACTIVE')
                        .first()

                    if (!isAuthorized) {
                        throw new Error(`Unauthorized: Client ${clientId} is not an active B2B partner for company ${targetCompanyIdResolved}. TARGET + MISSION requires explicit authorization.`)
                    }
                }
            }

            const resolvedCompanyId =
                assignmentMode === 'GLOBAL'
                    ? null
                    : assignmentMode === 'INTERNAL'
                        ? (company?.id || null)
                        : (targetCompanyIdResolved || null)

            const billingCompany = assignmentMode === 'INTERNAL' ? company : targetCompanyResolved
            await this.assertSubscriptionAccessForCompany(
                resolvedCompanyId,
                effectiveTrx,
                `initiate:${assignmentMode}:${template}`,
                billingCompany
            )

            const normalizedRefId =
                explicitRefId || (assignmentMode === 'TARGET' ? (targetDriverIdResolved || targetCompanyIdResolved || null) : null)

            // Receiver Validation Logic
            if (company && data.from_receiver) {
                const settings = (company as any)?.settings || {}
                const receivers = settings.receivers || {}
                const templateConfig = receivers[template] || {}

                // Default behavior: MISSION is closed, others are open
                const isTemplateNaturallyOpen = ['COMMANDE', 'VOYAGE'].includes(template)
                const isExplicitlyEnabled = templateConfig.enabled === true
                const isExplicitlyDisabled = templateConfig.enabled === false

                const canReceive = isExplicitlyEnabled || (isTemplateNaturallyOpen && !isExplicitlyDisabled)

                if (!canReceive) {
                    throw new Error(`This company is not accepting orders for template: ${template}`)
                }
            }

            const order = await Order.create({
                clientId,
                initiatorId: clientId,
                companyId: resolvedCompanyId,
                status: 'DRAFT',
                template: template,
                assignmentMode: assignmentMode as 'GLOBAL' | 'INTERNAL' | 'TARGET',
                priority: data.priority || 'MEDIUM',
                refId: normalizedRefId,
                vehicleId: data.vehicleId || null,
                assignmentAttemptCount: 0,
                metadata: data.metadata || {}
            }, { client: effectiveTrx })

            // Create unique OrderLeg for the 1-1 relationship
            const leg = await OrderLeg.create({
                orderId: order.id,
                status: 'PLANNED'
            }, { client: effectiveTrx })

            // Link leg back to order
            order.legId = leg.id
            await order.useTransaction(effectiveTrx).save()

            // Create default step
            // Create default step only if no steps provided
            if (!data.steps || data.steps.length === 0) {
                await Step.create({
                    orderId: order.id,
                    sequence: 0,
                    linked: false,
                    status: 'PENDING',
                    metadata: {},
                    isPendingChange: false
                }, { client: effectiveTrx })
            }

            if (!trx) await effectiveTrx.commit()

            await order.load('steps')
            await order.load('leg')
            return order
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Fetches detailed order with all relations preloaded.
     */
    async getOrderDetails(orderId: string, clientId?: string, options: { trx?: TransactionClientContract, withRoute?: boolean, json?: boolean, include?: string[] } = { withRoute: false, json: true }) {
        logger.debug({ orderId, clientId, options }, '[ORDER_DRAFT] Fetching order details')
        const query = Order.query({ client: options.trx })
            .preload('vehicle')
            .preload('steps', (q) => q.orderBy('sequence', 'asc')
                .preload('stops', (sq) => sq.orderBy('execution_order', 'asc').orderBy('display_order', 'asc')
                    .preload('address')
                    .preload('actions', (aq) => aq.preload('transitItem'))
                )
            )
            .preload('transitItems')
            .preload('bookings', (q) => q.preload('client').preload('transitItems').preload('pickupStop').preload('dropoffStop'))

        if (options.withRoute || options.include?.includes('leg')) {
            logger.debug({ orderId }, '[ORDER_DRAFT] Including heavy leg relationship')
            query.preload('leg')
        }

        if (orderId === 'latest') {
            if (!clientId) throw new Error('clientId is required for latest order retrieval')
            query.where('clientId', clientId).orderBy('createdAt', 'desc')
        } else {
            query.where('id', orderId)
            if (clientId) query.where('clientId', clientId)
        }

        const order = await query.first()

        if (!order) {
            logger.error({ orderId, clientId }, 'Order not found during getOrderDetails')
            throw new Error('Order not found')
        }

        // Apply shadow filtering before returning
        const filterShadows = (list: any[]) => {
            const shadows = list.filter(item => item.isPendingChange)

            // Deduplicate shadows to only keep the latest one per originalId
            const uniqueShadows = new Map<string, any>()
            shadows.forEach(s => {
                if (s.originalId) {
                    const existing = uniqueShadows.get(s.originalId)
                    // If no existing or this one is newer (or just fallback to ID comparison for stability)
                    if (!existing || (s.updatedAt || s.createdAt) > (existing.updatedAt || existing.createdAt) || s.id > existing.id) {
                        uniqueShadows.set(s.originalId, s)
                    }
                } else {
                    uniqueShadows.set(s.id, s)
                }
            })

            const dedupedShadows = Array.from(uniqueShadows.values())
            const originalsToReplace = dedupedShadows.map((s: any) => s.originalId).filter(Boolean)

            const activeItems = [
                ...list.filter(item => !item.isPendingChange && !originalsToReplace.includes(item.id)),
                ...dedupedShadows
            ]
            // Filter deletions (if any)
            return activeItems.filter(item => !item.isDeleteRequired)
        }

        const allStepsInOrder = order.steps || []
        const allStopsInOrder = allStepsInOrder.flatMap(s => s.stops || [])
        const allActionsInOrder = allStopsInOrder.flatMap(s => s.actions || [])

            ; (order as any).steps = filterShadows(allStepsInOrder)
                .sort((a: any, b: any) => {
                    const stopA = a.stops?.[0]
                    const stopB = b.stops?.[0]
                    if (stopA && stopB) {
                        return (stopA.executionOrder ?? stopA.displayOrder) - (stopB.executionOrder ?? stopB.displayOrder)
                    }
                    return a.sequence - b.sequence
                })
                .map(step => {
                    const conceptualStepId = step.isPendingChange ? step.originalId : step.id
                    const stepStops = allStopsInOrder.filter(s => s.stepId === conceptualStepId || s.stepId === step.id)

                        ; (step as any).stops = filterShadows(stepStops)
                            .sort((a: any, b: any) => (a.executionOrder ?? a.displayOrder) - (b.executionOrder ?? b.displayOrder))
                            .map(stop => {
                                const conceptualStopId = stop.isPendingChange ? stop.originalId : stop.id
                                const stopActions = allActionsInOrder.filter(a => a.stopId === conceptualStopId || a.stopId === stop.id)

                                    ; (stop as any).actions = filterShadows(stopActions)
                                return stop
                            })
                    return step
                })

            ; (order as any).transitItems = filterShadows(order.transitItems || [])

        // 2. Compute Routes (Dual Calculation) - Deferred if not requested
        let liveRoute = null
        let pendingRoute = null
        let validation = LogisticsService.validateDraftConsistency(this.buildVirtualState(order, { view: 'CLIENT' }))

        if (options.withRoute) {
            const visitedIds = new Set<string>()
            const startLocation = await this.getDriverStartLocation(order.driverId) || COCODY

            // In DRAFT or when viewing modifications, we always want the "virtual" optimized state
            const optimizedResult = await this.optimizeViaOrTools(order, { startLocation, visitedIds, useVirtualState: true })
            const formattedRoute = await this.mapOrToolsToVroomFormat(optimizedResult, order, startLocation)

            liveRoute = formattedRoute
            pendingRoute = formattedRoute // In this context (getOrderDetails), they represent the same "next potential state"
        }

        if (options.json !== false) {
            return {
                ...order.toJSON(),
                live_route: liveRoute,
                pending_route: pendingRoute,
                validation: validation
            } as any
        }

        // Attach virtual routes to the model instance for internal consumption
        ; (order as any).live_route = liveRoute
            ; (order as any).pending_route = pendingRoute
            ; (order as any).validation = validation

        return order
    }

    /**
     * Gets only the route (live and pending) for an order.
     */
    async getRoute(orderId: string, _clientId?: string, options: { live?: boolean, pending?: boolean, force?: boolean, simplify?: boolean, no_geo?: boolean } = { live: true, pending: true, force: false }, trx?: TransactionClientContract) {
        // If nothing requested (edge case), return empty
        if (!options.live && !options.pending) return {}

        const query = Order.query({ client: trx })
            .where('id', orderId)
            .preload('vehicle')
            .preload('leg')
            .preload('steps', (q) => q.orderBy('sequence', 'asc')
                .preload('stops', (sq) => sq.orderBy('execution_order', 'asc').orderBy('display_order', 'asc')
                    .preload('address')
                    .preload('actions', (aq) => aq.preload('transitItem'))
                )
            )
            .preload('transitItems')

        const order = await query.first()

        if (!order) {
            throw new Error('Order not found')
        }

        const promises = []
        const sources = { live: 'database', pending: 'redis' }

        // --- 1. LIVE ROUTE (Hybrid & Projected) ---
        if (options.live) {
            if (order.status !== 'DRAFT') {
                // Determine Live Projection from current GPS if available
                const startLocation = await this.getDriverStartLocation(order.driverId) || COCODY
                const visitedIds = new Set(order.metadata?.route_execution?.visited || []) as Set<string>

                const liveDbPromise = this.buildLiveRouteFromDB(order, trx)

                if (startLocation) {
                    const projectedPromise = this.optimizeViaOrTools(order, { startLocation, visitedIds, useVirtualState: true })
                        .then(async res => await this.mapOrToolsToVroomFormat(res, order))

                    promises.push(Promise.all([liveDbPromise, projectedPromise]).then(([db, proj]) => ({
                        ...db,
                        projected_route: proj
                    })))
                } else {
                    promises.push(liveDbPromise)
                }
                sources.live = 'hybrid'
            } else {
                // Determine Live Route via Calculation (Fallback for Draft)
                const visitedIds = new Set<string>() // empty for draft
                const startLocation = await this.getDriverStartLocation(order.driverId) || [-3.967, 5.350] as [number, number]

                // MISSION / INTERVENTION Bypass: Use direct sequence instead of OR-Tools optimization
                if (order.template === 'MISSION' || order.isIntervention) {
                    const virtualState = this.buildVirtualState(order, { view: 'CLIENT' })
                    const waypoints = [
                        { coordinates: startLocation, type: 'break' as const },
                        ...virtualState.steps.flatMap((s: any) => s.stops || []).map((stop: any) => ({
                            coordinates: stop.coordinates,
                            address_text: stop.address_text,
                            type: 'break' as const
                        }))
                    ]
                    const calcPromise = GeoService.calculateOptimizedRoute(waypoints)
                    promises.push(calcPromise)
                } else {
                    // Helper to format as VROOM-like response for frontend compatibility
                    const calcPromise = this.optimizeViaOrTools(order, { startLocation, visitedIds, useVirtualState: true })
                        .then(async res => await this.mapOrToolsToVroomFormat(res, order, startLocation))
                    promises.push(calcPromise)
                }
                sources.live = 'ortools'
            }
        } else {
            promises.push(Promise.resolve(null))
        }

        // --- 2. PENDING ROUTE (Redis Cache) ---
        if (options.pending) {
            const cacheKey = `order:pending_route:${orderId}`

            let cached = null
            if (!options.force) {
                cached = await redis.get(cacheKey)
            }

            if (cached) {
                promises.push(Promise.resolve(JSON.parse(cached)))
                sources.pending = 'redis'
            } else {
                const visitedIds = new Set<string>()
                const startLocation = await this.getDriverStartLocation(order.driverId) || [-3.967, 5.350] as [number, number]

                let calcPromise: Promise<any>
                if (order.template === 'MISSION' || order.isIntervention) {
                    const virtualState = this.buildVirtualState(order, { view: 'CLIENT' })
                    const waypoints = [
                        { coordinates: startLocation, type: 'break' as const },
                        ...virtualState.steps.flatMap((s: any) => s.stops || []).map((stop: any) => ({
                            coordinates: stop.coordinates,
                            address_text: stop.address_text,
                            type: 'break' as const
                        }))
                    ]
                    calcPromise = GeoService.calculateOptimizedRoute(waypoints)
                } else {
                    calcPromise = this.optimizeViaOrTools(order, { startLocation, visitedIds, useVirtualState: true })
                        .then(async (res) => {
                            const formatted = await this.mapOrToolsToVroomFormat(res, order, startLocation)
                            if (formatted) {
                                // Cache for 1h
                                await redis.set(cacheKey, JSON.stringify(formatted), 'EX', 3600)
                            }
                            return formatted
                        })
                }
                promises.push(calcPromise)
                sources.pending = 'ortools'
            }
        } else {
            promises.push(Promise.resolve(null))
        }

        const [liveRoute, pendingRoute] = await Promise.all(promises)

        const simplifyGeo = (route: any) => {
            if (!route) return null
            if (options.no_geo) {
                delete route.geometry
                delete route.actual_history
                delete route.full_geometry
            } else if (options.simplify) {
                if (route.geometry) route.geometry.coordinates = `[LineString with ${route.geometry.coordinates?.length || 0} pts]`
                if (route.actual_history) route.actual_history.coordinates = `[LineString with ${route.actual_history.coordinates?.length || 0} pts]`
                if (route.full_geometry) route.full_geometry.coordinates = `[LineString with ${route.full_geometry.coordinates?.length || 0} pts]`
            }
            return route
        }

        return {
            live_route: simplifyGeo(liveRoute),
            pending_route: simplifyGeo(pendingRoute),
            metadata: {
                live_source: sources.live,
                pending_source: sources.pending
            }
        }
    }

    /**
     * Builds a virtual representation of the order for validation.
     * CLIENT view: Uses shadow clones and respects deletion marks.
     * DRIVER view: Only stable, non-deleted components.
     */
    buildVirtualState(order: Order, options: { view: 'CLIENT' | 'DRIVER' } = { view: 'CLIENT' }): any {
        const filterDeleted = (list: any[]) => list.filter(item => !item.isDeleteRequired)

        const applyShadows = (list: any[]) => {
            const shadows = list.filter((item: any) => item.isPendingChange)

            // Deduplicate shadows
            const uniqueShadows = new Map<string, any>()
            shadows.forEach(s => {
                if (s.originalId) {
                    const existing = uniqueShadows.get(s.originalId)
                    // Robust timestamp comparison using numeric value
                    const sTime = s.updatedAt?.toMillis() || s.createdAt?.toMillis() || 0
                    const existingTime = existing?.updatedAt?.toMillis() || existing?.createdAt?.toMillis() || 0

                    if (!existing || sTime > existingTime || (sTime === existingTime && s.id > existing.id)) {
                        uniqueShadows.set(s.originalId, s)
                    }
                } else {
                    uniqueShadows.set(s.id, s)
                }
            })

            const dedupedShadows = Array.from(uniqueShadows.values())
            const originalsToReplace = dedupedShadows.map((s: any) => s.originalId).filter(Boolean)

            return [
                ...list.filter(item => !item.isPendingChange && !originalsToReplace.includes(item.id)),
                ...dedupedShadows
            ]
        }

        let filteredSteps = filterDeleted(order.steps || [])
        if (options.view === 'CLIENT') {
            filteredSteps = applyShadows(filteredSteps)
        } else {
            filteredSteps = filteredSteps.filter(s => !s.isPendingChange)
        }

        // Sort steps by sequence
        filteredSteps.sort((a, b) => a.sequence - b.sequence)

        const steps = filteredSteps.map(step => {
            const conceptualStepId = step.isPendingChange ? step.originalId : step.id

            // All stops in the order to find those conceptually belonging to this step
            const allStops = order.steps.flatMap(s => s.stops || [])
            let stepStops = allStops.filter(s => s.stepId === conceptualStepId || s.stepId === step.id)

            if (options.view === 'CLIENT') {
                stepStops = applyShadows(stepStops)
            } else {
                stepStops = stepStops.filter(s => !s.isPendingChange && !s.isDeleteRequired)
            }
            stepStops = filterDeleted(stepStops)
            // Fix: Consistency between DB preloads and virtual state
            stepStops.sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0)) // tout stop doit obligatoirement avoir un executionOrder

            return {
                id: step.id,
                sequence: step.sequence,
                linked: step.linked,
                is_pending_change: step.isPendingChange,
                is_delete_required: step.isDeleteRequired,
                stops: stepStops.map(stop => {
                    const conceptualStopId = stop.isPendingChange ? stop.originalId : stop.id

                    // All actions in the order to find those conceptually belonging to this stop
                    const allActions = allStops.flatMap(s => s.actions || [])
                    let stopActions = allActions.filter(a => a.stopId === conceptualStopId || a.stopId === stop.id)

                    if (options.view === 'CLIENT') {
                        stopActions = applyShadows(stopActions)
                    } else {
                        stopActions = stopActions.filter(a => !a.isPendingChange && !a.isDeleteRequired)
                    }
                    stopActions = filterDeleted(stopActions)

                    return {
                        id: stop.id,
                        address_id: stop.addressId,
                        address: typeof stop.address?.toJSON === 'function' ? stop.address.toJSON() : (stop.address || null),
                        address_text: stop.address?.formattedAddress || stop.address?.street || '',
                        coordinates: [stop.address?.lng || 0, stop.address?.lat || 0],
                        contact: (stop as any).contact,
                        opening_hours: stop.client?.opening_hours || null,
                        display_order: stop.displayOrder,
                        execution_order: stop.executionOrder,
                        status: stop.status,
                        metadata: stop.metadata,
                        is_pending_change: stop.isPendingChange,
                        is_delete_required: stop.isDeleteRequired,
                        actions: stopActions.map(action => {
                            const item = action.transitItemId ? order.transitItems.find((ti: any) => ti.id === action.transitItemId || (ti.isPendingChange && ti.originalId === action.transitItemId)) : null
                            return {
                                id: action.id,
                                type: action.type,
                                quantity: action.quantity,
                                transit_item_id: action.transitItemId,
                                transit_item: typeof action.transitItem?.toJSON === 'function' ? action.transitItem.toJSON() : (action.transitItem || null),
                                service_time: action.serviceTime || 300,
                                status: action.status,
                                metadata: action.metadata,
                                requirements: item?.metadata?.requirements || [],
                                is_pending_change: action.isPendingChange,
                                is_delete_required: action.isDeleteRequired
                            }
                        })
                    }
                })
            }
        })

        let filteredTransitItems = filterDeleted(order.transitItems || [])
        if (options.view === 'CLIENT') {
            filteredTransitItems = applyShadows(filteredTransitItems)
        } else {
            filteredTransitItems = filteredTransitItems.filter((ti: any) => !ti.isPendingChange)
        }

        const transitItems = filteredTransitItems.map((ti: any) => ({
            id: ti.id,
            name: ti.name,
            weight: ti.weight ?? null,
            dimensions: ti.dimensions,
            is_pending_change: ti.isPendingChange,
            is_delete_required: ti.isDeleteRequired
        }))

        return {
            transit_items: transitItems,
            steps: steps
        }
    }

    /**
     * Estimates a draft order (route + pricing).
     */
    async estimateDraft(orderId: string, clientId: string, trx?: TransactionClientContract) {
        const order = await this.getOrderDetails(orderId, clientId, { trx })
        const virtualState = this.buildVirtualState(order, { view: 'CLIENT' })

        const startLocation = await this.getDriverStartLocation(order.driverId) || COCODY as [number, number]

        const allStopsForRouting: any[] = [
            {
                coordinates: startLocation,
                type: 'break' as const
            }
        ]
        virtualState.steps.forEach((step: any) => {
            step.stops.forEach((stop: any) => {
                allStopsForRouting.push({
                    coordinates: stop.coordinates,
                    address_text: stop.address_text,
                    type: 'break' as const
                })
            })
        })

        if (allStopsForRouting.length < 2) {
            return { estimation: null, errors: ['Need at least 2 stops for estimation'] }
        }

        const routeDetails = await GeoService.calculateOptimizedRoute(allStopsForRouting)
        if (!routeDetails) throw new Error('Route calculation failed')

        // const pricingPackages: SimplePackageInfo[] = order.transitItems.map((ti: TransitItem) => ({
        //     dimensions: {
        //         weight: ti.weight ?? 0,
        //         ...ti.dimensions
        //     },
        //     quantity: 1
        // }))

        // Resolver le filtre de prix applicable
        const filter = await PricingFilterService.resolve(order.driverId, order.companyId, order.template, trx)
        if (!filter) throw new Error('Aucun filtre de prix trouvé pour cette commande')

        const orderedStops = virtualState.steps.flatMap((step: any) => step.stops || [])
        const stopPriceInputs: StopPriceInput[] = await this.buildStopPriceInputs(
            order.template,
            filter,
            orderedStops,
            routeDetails.legs || [],
            trx
        )

        const { calculatedAmount, finalAmount, stopBreakdowns } = PricingFilterService.calculateOrderPrice(filter, stopPriceInputs)

        // Résoudre la part chauffeur via la policy et le moteur de split
        const policy = await PaymentPolicyService.resolve(order.driverId, order.companyId, order.template, trx)
        const subscriptionRates = await subscriptionService.resolveRatesForOrder(order, trx)
        const splits = OrderPaymentService.calculateSplits({ amount: finalAmount, calculatedAmount }, policy, order.companyId, {
            template: order.template,
            commandeCommissionPercent: subscriptionRates.commandeCommissionPercent,
            ticketFeePercent: subscriptionRates.ticketFeePercent,
        })
        const driverRemuneration = splits.driverAmount

        const pricing = {
            clientFee: finalAmount,
            calculatedAmount,
            driverRemuneration,
            currency: 'XOF',
            breakdown: stopBreakdowns
        }

        return {
            estimation: {
                route: routeDetails,
                pricing
            },
            validation: LogisticsService.validateDraftConsistency(virtualState)
        }
    }

    /**
     * Submits a draft order for final validation and transition to PENDING.
     */
    async submitOrder(orderId: string, clientId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const order = await Order.query({ client: effectiveTrx })
                .where('id', orderId)
                .where('clientId', clientId)
                .preload('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('display_order', 'asc').preload('address').preload('actions', (aq) => aq.preload('transitItem'))))
                .preload('transitItems')
                .first()

            if (!order) {
                throw new Error(`Order not found [ID: ${orderId}] for client [ID: ${clientId}]`)
            }

            await this.assertSubscriptionAccessForCompany(
                order.companyId,
                effectiveTrx,
                `submit:${order.assignmentMode}:${order.template || 'COMMANDE'}`
            )

            if (order.status !== 'DRAFT') {
                throw new Error('Only draft orders can be submitted')
            }

            // 1. Calculate and cleanup orphaned transit items BEFORE validation
            const virtualState = this.buildVirtualState(order, { view: 'CLIENT' })
            const activeTransitItemIds = new Set<string>()
            virtualState.steps.forEach((step: any) => {
                step.stops.forEach((stop: any) => {
                    stop.actions.forEach((action: any) => {
                        if (action.transit_item_id) activeTransitItemIds.add(action.transit_item_id)
                    })
                })
            })

            await this.cleanupOrphanedTransitItems(order.id, effectiveTrx, activeTransitItemIds)

            // Re-fetch or update virtualState to reflect the cleanup
            // In DRAFT mode, it's safer to reload or just build state from re-fetched order
            const orderForValidation = await this.getOrderDetails(order.id, clientId, { trx: effectiveTrx })
            const virtualStateForValidation = this.buildVirtualState(orderForValidation, { view: 'CLIENT' })

            const validation = LogisticsService.validateOrderConsistency(virtualStateForValidation, 'SUBMIT')
            if (!validation.success || (validation.warnings && validation.warnings.length > 0)) {
                const errors = validation.validationErrors.map(e => `[ERROR] [${e.path}] ${e.message}`)
                const warnings = (validation.warnings || []).map(w => `[WARNING] [${w.path}] ${w.message}`)
                const allMessages = [...errors, ...warnings].join(', ')
                throw new Error(`Order validation failed: ${allMessages}`)
            }

            // Apply shadow changes (if any, though in DRAFT there shouldn't be much, but good practice)
            await this.applyShadowChanges(order.id, effectiveTrx)

            // Re-fetch to have merged state
            await order.load('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('display_order', 'asc').preload('address').preload('actions', (aq) => aq.preload('transitItem'))))

            await this.calculateOrderStats(order, effectiveTrx)

            // ── GENERATE PAYMENT INTENTS ──
            // Based on order template and resolved policy
            await OrderPaymentService.generateIntentsForOrder(order, effectiveTrx)

            order.status = 'PENDING'
            order.statusHistory = [
                ...(order.statusHistory || []),
                {
                    status: 'PENDING',
                    timestamp: DateTime.now().toISO()!,
                    note: 'Order submitted from draft'
                }
            ]
            await order.useTransaction(effectiveTrx).save()

            if (!trx) await (effectiveTrx as any).commit()

            emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                orderId: order.id,
                status: order.status,
                clientId: order.clientId
            }))

            // await this.dispatchService.dispatch(order, effectiveTrx)

            return order
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }

    /**
     * Merges shadow clones into originals and handles deletions.
     */
    async applyShadowChanges(orderId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            // Re-fetch order with all shadows
            const order = await Order.query({ client: effectiveTrx })
                .where('id', orderId)
                .preload('steps', (q) => q.preload('stops', (sq) => sq.preload('actions').preload('address')))
                .preload('transitItems')
                .first()

            if (!order) {
                throw new Error(`Order not found [ID: ${orderId}] during shadow merge`)
            }

            // 1. Merge Actions
            const allStops = order.steps.flatMap(s => s.stops || [])
            const allActions = allStops.flatMap(s => s.actions || [])

            for (const action of allActions) {
                if (action.isDeleteRequired) {
                    await db.from('action_proofs').useTransaction(effectiveTrx).where('action_id', action.id).delete()
                    await action.useTransaction(effectiveTrx).delete()
                    continue
                }
                if (action.isPendingChange && action.originalId) {
                    const original = allActions.find(a => a.id === action.originalId)
                    if (original) {
                        original.type = action.type
                        original.quantity = action.quantity
                        original.transitItemId = action.transitItemId
                        original.serviceTime = action.serviceTime
                        original.confirmationRules = action.confirmationRules
                        original.metadata = action.metadata
                        await original.useTransaction(effectiveTrx).save()

                        // Move proofs
                        await db.from('action_proofs').useTransaction(effectiveTrx).where('action_id', original.id).delete()
                        await db.from('action_proofs').useTransaction(effectiveTrx).where('action_id', action.id).update({ action_id: original.id })
                    } else {
                        // Fallback: search globally if not preloaded (rare)
                        const globalOriginal = await Action.find(action.originalId)
                        if (globalOriginal) {
                            globalOriginal.type = action.type
                            globalOriginal.quantity = action.quantity
                            globalOriginal.transitItemId = action.transitItemId
                            globalOriginal.serviceTime = action.serviceTime
                            globalOriginal.confirmationRules = action.confirmationRules
                            globalOriginal.metadata = action.metadata
                            await globalOriginal.useTransaction(effectiveTrx).save()

                            await db.from('action_proofs').useTransaction(effectiveTrx).where('action_id', globalOriginal.id).delete()
                            await db.from('action_proofs').useTransaction(effectiveTrx).where('action_id', action.id).update({ action_id: globalOriginal.id })
                        }
                    }
                    await action.useTransaction(effectiveTrx).delete()
                }
            }

            // 1.5 Merge Transit Items
            for (const item of order.transitItems || []) {
                if (item.isDeleteRequired) {
                    if (item.isPendingChange && item.originalId) {
                        const original = order.transitItems.find(ti => ti.id === item.originalId)
                        if (original) await original.useTransaction(effectiveTrx).delete()
                    }
                    await item.useTransaction(effectiveTrx).delete()
                    continue
                }
                if (item.isPendingChange && item.originalId) {
                    const original = order.transitItems.find(ti => ti.id === item.originalId)
                    if (original) {
                        original.name = item.name
                        original.description = item.description
                        original.weight = item.weight
                        original.dimensions = item.dimensions
                        original.packagingType = item.packagingType
                        original.unitaryPrice = item.unitaryPrice
                        original.metadata = item.metadata
                        await original.useTransaction(effectiveTrx).save()

                        // Relink actions that point to the shadow item
                        await db.from('actions').useTransaction(effectiveTrx).where('transit_item_id', item.id).update({ transit_item_id: original.id })
                    }
                    await item.useTransaction(effectiveTrx).delete()
                }
            }

            // 2. Merge Stops
            for (const stop of allStops) {
                if (stop.isDeleteRequired) {
                    // Actions should already be deleted above or cascade
                    await stop.useTransaction(effectiveTrx).delete()
                    continue
                }
                if (stop.isPendingChange && stop.originalId) {
                    const original = allStops.find(s => s.id === stop.originalId)
                    if (original) {
                        original.displayOrder = stop.displayOrder
                        original.executionOrder = stop.executionOrder
                        original.addressId = stop.addressId
                        original.client = stop.client
                        original.metadata = stop.metadata
                        await original.useTransaction(effectiveTrx).save()
                    }
                    await stop.useTransaction(effectiveTrx).delete()
                }
            }

            // 3. Merge Steps
            for (const step of order.steps) {
                if (step.isDeleteRequired) {
                    await step.useTransaction(effectiveTrx).delete()
                    continue
                }
                if (step.isPendingChange && step.originalId) {
                    const original = order.steps.find(s => s.id === step.originalId)
                    if (original) {
                        original.sequence = step.sequence
                        original.linked = step.linked
                        original.metadata = step.metadata
                        await original.useTransaction(effectiveTrx).save()
                    }
                    await step.useTransaction(effectiveTrx).delete()
                }
            }

            // 4. Reveal new components
            await db.from('steps').useTransaction(effectiveTrx).where('order_id', orderId).where('is_pending_change', true).update({ is_pending_change: false })
            await db.from('stops').useTransaction(effectiveTrx).where('order_id', orderId).where('is_pending_change', true).update({ is_pending_change: false })
            await db.from('actions').useTransaction(effectiveTrx).where('order_id', orderId).where('is_pending_change', true).update({ is_pending_change: false })
            await db.from('transit_items').useTransaction(effectiveTrx).where('order_id', orderId).where('is_pending_change', true).update({ is_pending_change: false })

            // RESET ORDER FLAG
            await db.from('orders').useTransaction(effectiveTrx).where('id', orderId).update({ has_pending_changes: false })

            // 6. Recalculate Route for confirmed structure
            const freshOrder = await Order.query({ client: effectiveTrx })
                .where('id', orderId)
                .preload('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('display_order', 'asc').preload('address').preload('actions', (aq) => aq.preload('transitItem'))))
                .preload('transitItems')
                .preload('leg')
                .firstOrFail()

            await this.calculateOrderStats(freshOrder, effectiveTrx)
            await freshOrder.useTransaction(effectiveTrx).save()

            if (!trx) await effectiveTrx.commit()
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Reverts all pending changes (shadows) and resets the order status.
     */
    async revertPendingChanges(orderId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            // 1. Delete all shadow Actions
            const shadowActions = await Action.query({ client: effectiveTrx }).where('orderId', orderId).where('isPendingChange', true)
            for (const action of shadowActions) {
                // Delete proofs first
                await ActionProof.query({ client: effectiveTrx }).where('actionId', action.id).delete()
                await action.useTransaction(effectiveTrx).delete()
            }

            // 2. Delete all shadow Stops
            await Stop.query({ client: effectiveTrx }).where('orderId', orderId).where('isPendingChange', true).delete()

            // 3. Delete all shadow Steps
            await Step.query({ client: effectiveTrx }).where('orderId', orderId).where('isPendingChange', true).delete()

            // 3.5 Delete all shadow Transit Items
            await TransitItem.query({ client: effectiveTrx }).where('orderId', orderId).where('isPendingChange', true).delete()

            // 4. Reset isDeleteRequired flags on original Actions
            await Action.query({ client: effectiveTrx }).where('orderId', orderId).where('isDeleteRequired', true).update({ isDeleteRequired: false })

            // 5. Reset isDeleteRequired flags on original Stops
            await Stop.query({ client: effectiveTrx }).where('orderId', orderId).where('isDeleteRequired', true).update({ isDeleteRequired: false })

            // 6. Reset isDeleteRequired flags on original Steps
            await Step.query({ client: effectiveTrx }).where('orderId', orderId).where('isDeleteRequired', true).update({ isDeleteRequired: false })

            // 6.5 Reset isDeleteRequired flags on original Transit Items
            await TransitItem.query({ client: effectiveTrx }).where('orderId', orderId).where('isDeleteRequired', true).update({ isDeleteRequired: false })

            // 7. Reset Order Flag
            await Order.query({ client: effectiveTrx }).where('id', orderId).update({ hasPendingChanges: false })

            // 8. Cleanup orbits
            await this.cleanupOrphanedAddresses(orderId, effectiveTrx)
            await this.cleanupOrphanedTransitItems(orderId, effectiveTrx)

            if (!trx) await effectiveTrx.commit()
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Deletes addresses that are no longer linked to any stop of this order.
     */
    async cleanupOrphanedAddresses(orderId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            // Find all address IDs currently linked to any stop of this order
            const activeStops = await db.from('stops').useTransaction(effectiveTrx).where('order_id', orderId).select('address_id')
            const activeAddressIds = activeStops.map(s => s.address_id)

            // Find all addresses owned by this order
            const ownedAddresses = await db.from('addresses').useTransaction(effectiveTrx).where('owner_id', orderId).where('owner_type', 'Order').select('id')

            for (const addr of ownedAddresses) {
                if (!activeAddressIds.includes(addr.id)) {
                    await db.from('addresses').useTransaction(effectiveTrx).where('id', addr.id).delete()
                }
            }

            if (!trx) await effectiveTrx.commit()
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Deletes transit items that are no longer linked to any action of this order.
     * If usedItemIds is provided, it uses that set instead of querying the current DB state.
     */
    async cleanupOrphanedTransitItems(orderId: string, trx?: TransactionClientContract, usedItemIds?: Set<string>) {
        const effectiveTrx = trx || await db.transaction()
        try {
            let activeItemIds: string[] = []

            if (usedItemIds) {
                activeItemIds = Array.from(usedItemIds)
            } else {
                // Find all transit item IDs currently linked to any action of this order (Current DB state)
                const activeActions = await db.from('actions').useTransaction(effectiveTrx).where('order_id', orderId).whereNotNull('transit_item_id').select('transit_item_id')
                activeItemIds = activeActions.map(a => a.transit_item_id)
            }

            // Find all transit items owned by this order
            const orderItems = await db.from('transit_items').useTransaction(effectiveTrx).where('order_id', orderId).select('id', 'original_id')

            for (const item of orderItems) {
                const isIdUsed = activeItemIds.includes(item.id)
                // Also check if any shadow of this item is used
                const isAnyShadowUsed = orderItems.some(other => other.original_id === item.id && activeItemIds.includes(other.id))

                if (!isIdUsed && !isAnyShadowUsed) {
                    await db.from('transit_items').useTransaction(effectiveTrx).where('id', item.id).delete()
                }
            }

            if (!trx) await effectiveTrx.commit()
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Recalculates route, timing and pricing.
     */
    async calculateOrderStats(order: Order, effectiveTrx: TransactionClientContract, options: { forcedStartLocation?: [number, number] } = {}) {
        // MissionService can call this with a plain Order.find() entity (without preloads).
        if (!(order as any).$preloaded?.steps) {
            await order.load('steps', (q) =>
                q.orderBy('sequence', 'asc').preload('stops', (sq) =>
                    sq.orderBy('display_order', 'asc').preload('address').preload('actions', (aq) => aq.preload('transitItem'))
                )
            )
        }
        if (!(order as any).$preloaded?.transitItems) {
            await order.load('transitItems')
        }

        // 0. Retrieve Driver position or fallback to Cocody (Lat: 5.350, Lng: -3.967) for re-optimization
        const startLocation = options.forcedStartLocation || await this.getDriverStartLocation(order.driverId) || [-3.967, 5.350]

        const execution = order.metadata?.route_execution || { visited: [], remaining: [] }
        const visitedIds = new Set(execution.visited || [])

        // 1. Get optimal sequence for REMAINING stops from VROOM (Skips for VOYAGE and MISSION)
        let routeResult: any = null

        if (order.template !== 'VOYAGE' && order.template !== 'MISSION') {
            const liveState = this.buildVirtualState(order, { view: 'DRIVER' })

            // Filter out visited stops from the optimization pool
            if (liveState.steps && Array.isArray(liveState.steps)) {
                liveState.steps = liveState.steps.map((step: any) => ({
                    ...step,
                    stops: (step.stops || []).filter((s: any) => !visitedIds.has(s.id))
                })).filter((step: any) => step.stops.length > 0)
            }

            routeResult = await this.optimizeViaOrTools(order, { startLocation, visitedIds: visitedIds as Set<string> })
        }

        // If optimization returns null (e.g. no stops to optimize, or bypassed template), we still need to ensure metadata is consistent
        // This handles cases where order is just created with stops but route hasn't been calculated yet
        const meta = order.metadata || {}

        let newRemaining: string[] = []
        let planned: string[] = []

        const optimizedStopOrder: any[] = Array.isArray(routeResult?.stopOrder) ? routeResult.stopOrder : []
        const hasValidOptimizedRoute = routeResult && routeResult.status === 'success' && optimizedStopOrder.length > 0

        if (hasValidOptimizedRoute) {
            newRemaining = optimizedStopOrder.map((s: any) => s.stop_id)
            // Concatenation of Past + Optimized Future
            planned = [...(execution?.visited || []), ...newRemaining]
        } else {
            // Fallback: If optimization didn't run or failed, use current stops order as default plan
            // This ensures new orders have a valid initial state
            const allStops = (order.steps || []).flatMap((s: any) => s.stops || [])
            newRemaining = allStops.filter(s => !visitedIds.has(s.id)).map(s => s.id)
            planned = allStops.map(s => s.id)
        }

        meta.route_execution = {
            visited: execution?.visited || [],
            remaining: newRemaining,
            planned: planned
        }
        order.metadata = meta
        await order.useTransaction(effectiveTrx).save()

        const allStops = (order.steps || []).flatMap((s: any) => s.stops || [])

        if (hasValidOptimizedRoute) {
            // 2. Update executionOrder on each stop based on OR-Tools result
            // Reset executionOrder for all stops before applying new results
            for (const stop of allStops) {
                stop.executionOrder = null
            }

            let maxExecutionOrder = -1

            // Apply optimized order
            for (const optimizedStop of optimizedStopOrder) {
                const stop = allStops.find((s: any) => s.id === optimizedStop.stop_id)
                if (stop) {
                    stop.executionOrder = optimizedStop.execution_order
                    maxExecutionOrder = Math.max(maxExecutionOrder, optimizedStop.execution_order)
                    await stop.useTransaction(effectiveTrx).save()
                }
            }

            // Handle dropped stops (append to end)
            if (routeResult.droppedStops && routeResult.droppedStops.length > 0) {
                for (const droppedStopId of routeResult.droppedStops) {
                    const stop = allStops.find((s: any) => s.id === droppedStopId)
                    if (stop) {
                        maxExecutionOrder++
                        stop.executionOrder = maxExecutionOrder
                        await stop.useTransaction(effectiveTrx).save()
                    }
                }
            }
        } else {
            // Fallback: maintain natural ordering for VOYAGE, MISSION, or failed optimizations
            let fallbackExecutionOrder = 0
            for (const stop of allStops) {
                if (stop.executionOrder === null || stop.executionOrder === undefined) {
                    stop.executionOrder = fallbackExecutionOrder
                    await stop.useTransaction(effectiveTrx).save()
                }
                fallbackExecutionOrder++
            }
        }

        // 3. Validate all stops have an executionOrder
        for (const stop of allStops) {
            // Skip stops marked for deletion as they are not sent to optimization
            if (stop.isDeleteRequired) continue

            // Stops not visited should have an executionOrder now
            if (!visitedIds.has(stop.id) && stop.executionOrder === null) {
                throw new Error(`Critical: Stop [ID: ${stop.id}] has no executionOrder after optimization`)
            }
        }

        // 4. Sort steps and stops based EXCLUSIVELY on executionOrder (visited stops keep their order from history)
        // For visited stops, we could use their visited index, but for the rest, executionOrder is king.

        // Sorting stops within steps
        const currentSteps = order.steps || []

        currentSteps.forEach(s => {
            if (s.stops) {
                s.stops.sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0))
            }
        })

        // Sorting steps by their first stop's executionOrder
        order.steps = currentSteps.sort((a, b) => {
            const stopA = a.stops?.[0]
            const stopB = b.stops?.[0]
            if (!stopA || !stopB) return 0
            return (stopA.executionOrder ?? 0) - (stopB.executionOrder ?? 0)
        })

        const allStopsForRouting: any[] = [
            {
                coordinates: startLocation || COCODY,
                type: 'break' as const
            }
        ]
        for (const step of order.steps) {
            for (const stop of step.stops) {
                allStopsForRouting.push({
                    address_id: stop.addressId,
                    address_text: stop.address?.formattedAddress || '',
                    coordinates: [stop.address?.lng || 0, stop.address?.lat || 0],
                    type: 'break' as const,
                    stop_id: stop.id
                })
            }
        }

        if (allStopsForRouting.length < 2) return

        const routeDetails = await GeoService.calculateOptimizedRoute(allStopsForRouting)
        if (!routeDetails) return

        let totalServiceTimeSeconds = 0
        for (const step of order.steps) {
            for (const stop of step.stops) {
                for (const action of stop.actions) {
                    totalServiceTimeSeconds += action.serviceTime || 300
                }
            }
        }

        order.calculationEngine = routeDetails.calculation_engine
        order.totalDistanceMeters = routeDetails.global_summary.total_distance_meters
        order.totalDurationSeconds = routeDetails.global_summary.total_duration_seconds + totalServiceTimeSeconds

        // Rebuild Legs (Single Unique Leg update)
        if (!order.leg) {
            await order.load('leg', (q) => q.useTransaction(effectiveTrx))
        }

        const leg = order.leg || await OrderLeg.create({ orderId: order.id, status: 'PLANNED' }, { client: effectiveTrx })

        const mergedGeometry: { type: 'LineString', coordinates: number[][] } = { type: 'LineString', coordinates: [] }
        let totalDistance = 0
        let totalDuration = 0
        let cumulativeDistance = 0
        let cumulativeDuration = 0

        for (let i = 0; i < routeDetails.legs.length; i++) {
            const legData = routeDetails.legs[i]

            // Merge coordinates
            if (legData.geometry && legData.geometry.coordinates) {
                mergedGeometry.coordinates.push(...legData.geometry.coordinates)
            }

            totalDistance += legData.distance_meters
            totalDuration += legData.duration_seconds

            cumulativeDistance += legData.distance_meters
            cumulativeDuration += legData.duration_seconds

            // Update Destination Stop Metadata
            const nextStopWp = allStopsForRouting[i + 1]
            if (nextStopWp && nextStopWp.stop_id) {
                const stop = await Stop.find(nextStopWp.stop_id, { client: effectiveTrx })
                if (stop) {
                    const meta = stop.metadata || {}
                    meta.route_info = {
                        arrival_offset: cumulativeDuration,
                        distance_from_start: cumulativeDistance
                    }
                    stop.metadata = meta
                    await stop.useTransaction(effectiveTrx).save()
                }

                // Add service time for cumulative offset
                const stopObj = order.steps.flatMap(s => s.stops).find(s => s.id === nextStopWp.stop_id)
                let serviceTime = 0
                if (stopObj && stopObj.actions) {
                    serviceTime = stopObj.actions.reduce((sum, a) => sum + (a.serviceTime || 300), 0)
                }
                cumulativeDuration += serviceTime
            }
        }

        // Update the unique leg
        leg.startAddressId = allStopsForRouting[0].address_id
        leg.endAddressId = allStopsForRouting[allStopsForRouting.length - 1].address_id
        leg.distanceMeters = totalDistance
        leg.durationSeconds = totalDuration
        leg.geometry = mergedGeometry
        await leg.useTransaction(effectiveTrx).save()

        // Ensure Order points to this leg
        if (order.legId !== leg.id) {
            order.legId = leg.id
        }

        const pricingPackages: SimplePackageInfo[] = order.transitItems?.map((ti: any) => ({
            dimensions: {
                weight: ti.weight ?? 0,
                ...ti.dimensions
            },
            quantity: 1
        })) || []

        // Resolver le filtre de prix applicable
        const filter = await PricingFilterService.resolve(order.driverId, order.companyId, order.template, effectiveTrx)
        if (filter) {
            // Preserve manually overridden price if one exists (order-level)
            const existingPricingData = order.pricingData as any
            const orderOverrideAmount = existingPricingData?.isPriceOverridden ? existingPricingData.clientFee : undefined

            const allStops = order.steps.flatMap((s: any) => s.stops || [])
            let stopPriceInputs: StopPriceInput[] = []

            if (allStops.length > 0 && routeDetails?.legs) {
                stopPriceInputs = await this.buildStopPriceInputs(
                    order.template,
                    filter,
                    allStops,
                    routeDetails.legs || [],
                    effectiveTrx
                )
            } else {
                // Fallback to order-level summary
                stopPriceInputs.push({
                    template: order.template,
                    distanceKm: (order.totalDistanceMeters || 0) / 1000,
                    durationSeconds: order.totalDurationSeconds || 0,
                    weightKg: pricingPackages.reduce((acc, p) => acc + (p.dimensions?.weight || 0), 0) / 1000,
                    overrideAmount: orderOverrideAmount
                })
            }

            const { calculatedAmount, finalAmount, stopBreakdowns } = PricingFilterService.calculateOrderPrice(filter, stopPriceInputs)

            // Résoudre la part chauffeur via la policy et le moteur de split
            const policy = await PaymentPolicyService.resolve(order.driverId, order.companyId, order.template, effectiveTrx)
            const subscriptionRates = await subscriptionService.resolveRatesForOrder(order, effectiveTrx)
            const splits = OrderPaymentService.calculateSplits({ amount: finalAmount, calculatedAmount }, policy, order.companyId, {
                template: order.template,
                commandeCommissionPercent: subscriptionRates.commandeCommissionPercent,
                ticketFeePercent: subscriptionRates.ticketFeePercent,
            })
            const driverRemuneration = splits.driverAmount

            order.pricingData = {
                clientFee: finalAmount,
                calculatedAmount,
                driverRemuneration,
                isPriceOverridden: (existingPricingData?.isPriceOverridden || stopBreakdowns.some(b => b.isPriceOverridden)),
                currency: 'XOF',
                breakdown: stopBreakdowns
            } as any
        }

        // 5. Centralized Notification: Notify all parties after successful recalculation
        // We use a commit hook to ensure we only notify if the DB update persisted.
        effectiveTrx.after('commit', () => {
            wsService.notifyOrderRouteUpdate(order.id, order.driverId, order.clientId, { template: order.template || undefined })
        })
    }

    /**
     * Pushes pending changes (shadows) to the live order.
     */
    async pushUpdates(orderId: string, clientId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const order = await Order.find(orderId, { client: effectiveTrx })
            if (!order || order.clientId !== clientId) {
                throw new Error('Order not found or access denied')
            }

            // 1. Apply merge logic
            await this.applyShadowChanges(order.id, effectiveTrx)

            // 2. Recalculate accounting
            // Reload order to get fresh state
            const freshOrder = await Order.query({ client: effectiveTrx })
                .where('id', orderId)
                .preload('steps', (q) => q.orderBy('sequence', 'asc')
                    .preload('stops', (sq) => sq.orderBy('execution_order', 'asc').orderBy('display_order', 'asc')
                        .preload('address') // Ensure address is loaded for optimization
                        .preload('actions', (aq) => aq.preload('transitItem'))
                    )
                )
                .preload('transitItems')
                .firstOrFail()

            await this.calculateOrderStats(freshOrder, effectiveTrx)
            await freshOrder.useTransaction(effectiveTrx).save()

            if (!trx) await effectiveTrx.commit()

            // 3. Notify real-time listeners
            emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                orderId: order.id,
                status: order.status,
                clientId: order.clientId,
                //@ts-ignore // error ici payload n'est pas reconnu
                payload: {
                    type: 'order_updated',
                    message: 'Order has been updated by client'
                }
            }))

            return freshOrder
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Internal helper to map template data to OrTools microservice and perform optimization.
     */
    private async optimizeViaOrTools(order: Order, options: { startLocation?: [number, number], visitedIds: Set<string>, useVirtualState?: boolean }) {
        const stops: OrToolsStop[] = []
        const coords: Array<{ lat: number, lon: number }> = []

        // 0. Check for Driver Choice (Fixed Next Stop)
        const driverNextStopId = order.metadata?.driver_choices?.next_stop_id

        // 1. Determine which stops to use
        let targetStops: any[] = []
        if (options.useVirtualState) {
            const virtualState = this.buildVirtualState(order, { view: 'CLIENT' })
            targetStops = virtualState.steps.flatMap((s: any) => s.stops || [])
        } else {
            targetStops = order.steps.flatMap(s => s.stops || [])
        }

        // Filter out stops marked for deletion
        targetStops = targetStops.filter(s => !s.isDeleteRequired)

        // Ensure stable input order for OR-Tools regardless of preloads/context
        targetStops.sort((a, b) => a.id.localeCompare(b.id))

        const allRemainingStops = targetStops.filter(s => !options.visitedIds.has(s.id))

        // 2. Map Coordinates (index-based for matrix)
        let index = 0
        if (options.startLocation) {
            coords.push({ lat: options.startLocation[1], lon: options.startLocation[0] })
            index++ // Location 0 is the startLocation
        }

        for (const stop of allRemainingStops) {
            const lat = stop.address?.lat
            const lon = stop.address?.lng
            // Note: We MUST filter out stops without coordinates BEFORE indexing for the matrix
            if (lat === undefined || lon === undefined) continue

            const actions: OrToolsAction[] = (stop.actions || []).map((a: any) => ({
                type: (a.type || '').toLowerCase() as any,
                item_id: a.transitItemId || a.transit_item_id || undefined,
                quantity: a.quantity || 0,
                weight: a.transitItem?.weight || a.transit_item?.weight || 0,
                volume: 0,
                service_time: a.serviceTime || a.service_time || 120
            }))

            coords.push({ lat, lon })
            stops.push({
                id: stop.id,
                index: index++,
                actions,
                is_frozen: stop.id === driverNextStopId
            })
        }

        if (stops.length === 0) {
            // Edge case: No stops to optimize. Return valid empty result.
            return {
                status: 'success',
                stopOrder: [],
                totalDistance: 0,
                totalTime: 0,
                droppedStops: [],
                message: 'No stops to optimize'
            }
        }

        // 2. Prepare Vehicle
        const vehicle = {
            max_weight: order.vehicle?.specs?.maxWeight || 10000,
            max_volume: order.vehicle?.specs?.cargoVolume || 50,
            start_index: 0, // Always 0 as we put startLocation at coords[0]
            end_index: null // null indicates Open Route (handled by solver.py)
        }

        // 3. Optimize
        const result = await this.orToolsService.optimize(stops, vehicle, coords)

        // 4. Post-process to ensure Driver Choice is respected if OR-Tools didn't put it first
        if (result && result.status === 'success' && driverNextStopId) {
            const targetStopIndex = result.stopOrder.findIndex(s => s.stop_id === driverNextStopId)
            if (targetStopIndex > 0) {
                const [chosenStop] = result.stopOrder.splice(targetStopIndex, 1)
                result.stopOrder.unshift(chosenStop)
                // Re-calculate execution_order
                result.stopOrder.forEach((s, i) => s.execution_order = i)
            }
        }

        return result
    }

    /**
     * Maps OR-Tools optimization result to VROOM-like format for frontend compatibility.
     */
    private async mapOrToolsToVroomFormat(result: any, order: Order, startLocation?: [number, number]): Promise<any> {
        if (!result || result.status !== 'success') return null
        const allStopsInOrder = order.steps.flatMap(s => s.stops || [])

        // Fallback to "Cocody, Abidjan" if no user position but needed for path tracing
        const effectiveStartLocation = startLocation || COCODY as [number, number]

        // 1. Prepare points for geometry calculation in optimized order
        const stopsPoints = result.stopOrder.map((s: any) => {
            const stop = allStopsInOrder.find(sm => sm.id === s.stop_id)
            return {
                stopId: s.stop_id,
                lat: stop?.address?.lat,
                lng: stop?.address?.lng,
                displayOrder: stop?.displayOrder || 0
            }
        }).filter((p: any) => p.lat !== undefined)

        // Fix 1: Prepend effective start location to the points for complete path tracing
        const pointsForGeometry = [
            { lat: effectiveStartLocation[1], lng: effectiveStartLocation[0], isStart: true },
            ...stopsPoints
        ]

        let geometry = { type: 'LineString', coordinates: [] as any[] }
        let routeDetails: any = null

        // 2. Fetch fresh geometry for this optimized sequence
        if (pointsForGeometry.length >= 2) {
            routeDetails = await GeoService.calculateOptimizedRoute(pointsForGeometry.map(p => ({
                coordinates: [p.lng, p.lat],
                type: 'break'
            })))
            if (routeDetails) {
                const allCoords = routeDetails.legs.flatMap((l: any) => l.geometry.coordinates)
                geometry = { type: 'LineString', coordinates: allCoords }
            }
        }

        // 3. Build stop metadata synchronized with the line geometry
        let cumulativeDistance = 0
        let cumulativeDuration = 0

        // Skip the first point (start location) for the stops metadata mapping
        const stops = stopsPoints.map((p: any, i: number) => {
            // Because we added start location at index 0, the first leg corresponds to start -> first stop
            if (routeDetails?.legs?.[i]) {
                cumulativeDistance += routeDetails.legs[i].distance_meters
                cumulativeDuration += routeDetails.legs[i].duration_seconds
            }

            return {
                stopId: p.stopId,
                execution_order: i,
                display_order: p.displayOrder,
                arrival: cumulativeDuration,
                arrival_time: this.formatSecondsToHm(cumulativeDuration),
                duration: cumulativeDuration,
                distance: cumulativeDistance
            }
        })

        return {
            summary: {
                total_distance: routeDetails?.global_summary?.total_distance_meters || result.totalDistance || 0,
                total_duration: routeDetails?.global_summary?.total_duration_seconds || result.totalTime || 0
            },
            geometry: geometry,
            stops: stops,
            raw: result
        }
    }

    private formatSecondsToHm(totalSeconds: number): string {
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const seconds = totalSeconds % 60

        const parts = []
        if (hours > 0) parts.push(`${hours}h`)
        if (minutes > 0) parts.push(`${minutes}min`)
        if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)

        return `{ ${parts.join(' , ')} }`
    }
}
