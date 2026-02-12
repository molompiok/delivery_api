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
import GeoService from '#services/geo_service'
import PricingService, { SimplePackageInfo } from '#services/pricing_service'
import OrderStatusUpdated from '#events/order_status_updated'
import DispatchService from '#services/dispatch_service'
import LogisticsService from '#services/logistics_service'
import { inject } from '@adonisjs/core'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import ActionService from './action_service.js'
import TransitItem from '#models/transit_item'
import VroomService from '../vroom_service.js'
import OrToolsService, { OrToolsStop, OrToolsAction } from '../optimizer/or_tools_service.js'
import redis from '@adonisjs/redis/services/main'
import wsService from '#services/ws_service'

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
        protected vroomService: VroomService,
        protected orToolsService: OrToolsService
    ) { }

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
                arrival_time: this.vroomService.formatSecondsToHm(arrival),
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

    /**
     * Initiates a new order in DRAFT status.
     */
    async initiateOrder(clientId: string, data: any = {}, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const order = await Order.create({
                clientId,
                status: 'DRAFT',
                assignmentMode: data.assignment_mode || 'GLOBAL',
                priority: data.priority || 'MEDIUM',
                refId: data.ref_id || null,
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
    async getOrderDetails(orderId: string, clientId?: string, options: { trx?: TransactionClientContract, withRoute?: boolean } = { withRoute: false }) {
        const query = Order.query({ client: options.trx })
            .preload('vehicle')
            .preload('steps', (q) => q.orderBy('sequence', 'asc')
                .preload('stops', (sq) => sq.orderBy('display_order', 'asc')
                    .preload('address')
                    .preload('actions', (aq) => aq.preload('transitItem'))
                )
            )
            .preload('transitItems')

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
            const startLocation = await this.getDriverStartLocation(order.driverId)

            const [lR, pR] = await Promise.all([
                this.optimizeViaOrTools(order, { startLocation, visitedIds }).then(res => this.mapOrToolsToVroomFormat(res, order)),
                this.optimizeViaOrTools(order, { startLocation, visitedIds }).then(res => this.mapOrToolsToVroomFormat(res, order))
            ])
            liveRoute = lR
            pendingRoute = pR
        }

        return {
            ...order.toJSON() as Order,
            live_route: liveRoute,
            pending_route: pendingRoute,
            validation: validation
        }
    }

    /**
     * Gets only the route (live and pending) for an order.
     */
    async getRoute(orderId: string, _clientId?: string, options: { live?: boolean, pending?: boolean, force?: boolean } = { live: true, pending: true, force: false }, trx?: TransactionClientContract) {
        // If nothing requested (edge case), return empty
        if (!options.live && !options.pending) return {}

        const query = Order.query({ client: trx })
            .where('id', orderId)
            .preload('vehicle')
            .preload('leg')
            .preload('steps', (q) => q.preload('stops', (sq) => sq.preload('address').preload('actions', (aq) => aq.preload('transitItem'))))
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
                const startLocation = await this.getDriverStartLocation(order.driverId)
                const visitedIds = new Set(order.metadata?.route_execution?.visited || []) as Set<string>

                const liveDbPromise = this.buildLiveRouteFromDB(order, trx)

                if (startLocation) {
                    const projectedPromise = this.optimizeViaOrTools(order, { startLocation, visitedIds })
                        .then(res => this.mapOrToolsToVroomFormat(res, order))

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
                const startLocation = await this.getDriverStartLocation(order.driverId)

                // Helper to format as VROOM-like response for frontend compatibility
                const calcPromise = this.optimizeViaOrTools(order, { startLocation, visitedIds })
                    .then(res => this.mapOrToolsToVroomFormat(res, order))

                promises.push(calcPromise)
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
                // Calculate and Cache
                const visitedIds = new Set<string>()
                const startLocation = await this.getDriverStartLocation(order.driverId)

                const calcPromise = this.optimizeViaOrTools(order, { startLocation, visitedIds })
                    .then(async (res) => {
                        const formatted = this.mapOrToolsToVroomFormat(res, order)
                        if (formatted) {
                            // Cache for 1h
                            await redis.set(cacheKey, JSON.stringify(formatted), 'EX', 3600)
                        }
                        return formatted
                    })
                promises.push(calcPromise)
                sources.pending = 'ortools'
            }
        } else {
            promises.push(Promise.resolve(null))
        }

        const [liveRoute, pendingRoute] = await Promise.all(promises)

        return {
            live_route: liveRoute,
            pending_route: pendingRoute,
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
            const shadows = list.filter(item => item.isPendingChange)

            // Deduplicate shadows
            const uniqueShadows = new Map<string, any>()
            shadows.forEach(s => {
                if (s.originalId) {
                    const existing = uniqueShadows.get(s.originalId)
                    if (!existing || (s.updatedAt || s.createdAt) > (existing.updatedAt || existing.createdAt) || s.id > existing.id) {
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
            stepStops.sort((a, b) => a.displayOrder - b.displayOrder)

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
                        address_text: stop.address?.formattedAddress || stop.address?.street || '',
                        coordinates: [stop.address?.lng || 0, stop.address?.lat || 0],
                        opening_hours: stop.client?.opening_hours || null,
                        display_order: stop.displayOrder,
                        execution_order: stop.executionOrder,
                        is_pending_change: stop.isPendingChange,
                        is_delete_required: stop.isDeleteRequired,
                        actions: stopActions.map(action => {
                            const item = action.transitItemId ? order.transitItems.find(ti => ti.id === action.transitItemId || (ti.isPendingChange && ti.originalId === action.transitItemId)) : null
                            return {
                                id: action.id,
                                type: action.type,
                                quantity: action.quantity,
                                transit_item_id: action.transitItemId,
                                service_time: action.serviceTime || 300,
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
            filteredTransitItems = filteredTransitItems.filter(ti => !ti.isPendingChange)
        }

        const transitItems = filteredTransitItems.map(ti => ({
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

        const allStopsForRouting: any[] = []
        virtualState.steps.forEach((step: any) => {
            step.stops.forEach((stop: any) => {
                allStopsForRouting.push({
                    address_text: stop.address_text,
                    type: 'break'
                })
            })
        })

        if (allStopsForRouting.length < 2) {
            return { estimation: null, errors: ['Need at least 2 stops for estimation'] }
        }

        const routeDetails = await GeoService.calculateOptimizedRoute(allStopsForRouting)
        if (!routeDetails) throw new Error('Route calculation failed')

        const pricingPackages: SimplePackageInfo[] = order.transitItems.map(ti => ({
            dimensions: {
                weight: ti.weight ?? 0,
                ...ti.dimensions
            },
            quantity: 1
        }))

        const pricing = await PricingService.calculateFees(
            routeDetails.global_summary.total_distance_meters,
            routeDetails.global_summary.total_duration_seconds,
            pricingPackages
        )

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
                const errors = validation.errors.map(e => `[ERROR] [${e.path}] ${e.message}`)
                const warnings = (validation.warnings || []).map(w => `[WARNING] [${w.path}] ${w.message}`)
                const allMessages = [...errors, ...warnings].join(', ')
                throw new Error(`Order validation failed: ${allMessages}`)
            }

            // Apply shadow changes (if any, though in DRAFT there shouldn't be much, but good practice)
            await this.applyShadowChanges(order.id, effectiveTrx)

            // Re-fetch to have merged state
            await order.load('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('display_order', 'asc').preload('address').preload('actions', (aq) => aq.preload('transitItem'))))

            await this.finalizeOrderAccounting(order, effectiveTrx)

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
                .preload('steps', (q) => q.preload('stops', (sq) => sq.preload('actions')))
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

            // 5. Cleanup orbits
            await this.cleanupOrphanedAddresses(orderId, effectiveTrx)
            await this.cleanupOrphanedTransitItems(orderId, effectiveTrx)

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
    async finalizeOrderAccounting(order: Order, effectiveTrx: TransactionClientContract, options: { forcedStartLocation?: [number, number] } = {}) {
        // 0. Retrieve Driver position for re-optimization (Use provided GPS if forced)
        const startLocation = options.forcedStartLocation || await this.getDriverStartLocation(order.driverId)

        const execution = order.metadata?.route_execution || { visited: [], remaining: [] }
        const visitedIds = new Set(execution.visited || [])

        // 1. Get optimal sequence for REMAINING stops from VROOM
        const liveState = this.buildVirtualState(order, { view: 'DRIVER' })

        // Filter out visited stops from the optimization pool
        if (liveState.steps) {
            liveState.steps = liveState.steps.map((step: any) => ({
                ...step,
                stops: step.stops.filter((s: any) => !visitedIds.has(s.id))
            })).filter((step: any) => step.stops.length > 0)
        }

        const routeResult = await this.optimizeViaOrTools(order, { startLocation, visitedIds: visitedIds as Set<string> })

        if (routeResult && routeResult.status === 'success') {
            const newRemaining = routeResult.stopOrder.map((s: any) => s.stop_id)
            const meta = order.metadata || {}
            meta.route_execution = {
                visited: execution.visited || [],
                remaining: newRemaining,
                // Concatenation of Past + Optimized Future
                planned: [...(execution.visited || []), ...newRemaining]
            }
            order.metadata = meta
            await order.useTransaction(effectiveTrx).save()

            // Update executionOrder on each stop based on OR-Tools result
            for (const optimizedStop of routeResult.stopOrder) {
                const allStops = order.steps.flatMap(s => s.stops || [])
                const stop = allStops.find(s => s.id === optimizedStop.stop_id)
                if (stop) {
                    stop.executionOrder = optimizedStop.execution_order
                    await stop.useTransaction(effectiveTrx).save()
                }
            }
        }

        // 2. Get high-fidelity legs via Valhalla, sorted by executionOrder
        order.steps = order.steps.sort((a, b) => {
            const stopA = a.stops?.[0]
            const stopB = b.stops?.[0]
            if (!stopA || !stopB) return 0
            return (stopA.executionOrder ?? stopA.displayOrder) - (stopB.executionOrder ?? stopB.displayOrder)
        })

        const allStopsForRouting: any[] = []
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

        const pricingPackages: SimplePackageInfo[] = order.transitItems.map(ti => ({
            dimensions: {
                weight: ti.weight ?? 0,
                ...ti.dimensions
            },
            quantity: 1
        }))

        order.pricingData = await PricingService.calculateFees(
            order.totalDistanceMeters!,
            order.totalDurationSeconds!,
            pricingPackages
        )

        // 3. Centralized Notification: Notify all parties after successful recalculation
        // We use a commit hook to ensure we only notify if the DB update persisted.
        effectiveTrx.after('commit', () => {
            wsService.notifyOrderRouteUpdate(order.id, order.driverId, order.clientId)
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
                .preload('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('display_order', 'asc').preload('actions', (aq) => aq.preload('transitItem'))))
                .preload('transitItems')
                .firstOrFail()

            await this.finalizeOrderAccounting(freshOrder, effectiveTrx)
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
     * Internal helper to map domain data to OrTools microservice and perform optimization.
     */
    private async optimizeViaOrTools(order: Order, options: { startLocation?: [number, number], visitedIds: Set<string> }) {
        const stops: OrToolsStop[] = []
        const coords: Array<{ lat: number, lon: number }> = []

        // 0. Check for Driver Choice (Fixed Next Stop)
        const driverNextStopId = order.metadata?.driver_choices?.next_stop_id

        // 1. Map Coordinates (index-based for matrix)
        let index = 0
        const allRemainingStops = order.steps.flatMap(s => s.stops || []).filter(s => !options.visitedIds.has(s.id))

        // If driver chose a stop, we might want to prioritize it or fix it.
        // For now, let's identify it.

        for (const stop of allRemainingStops) {
            if (!stop.address) continue

            coords.push({ lat: stop.address.lat, lon: stop.address.lng })

            const actions: OrToolsAction[] = stop.actions.map(a => ({
                type: a.type.toLowerCase() as any,
                item_id: a.transitItemId || undefined,
                quantity: a.quantity,
                weight: a.transitItem?.weight || 0,
                volume: 0, // TODO: add volume to transit item
                service_time: a.serviceTime || 120
            }))

            stops.push({
                id: stop.id,
                index: index++,
                actions,
                is_frozen: stop.id === driverNextStopId ? false : false // We could add a 'is_fixed' flag to Python later
            })
        }

        if (stops.length === 0) return null

        // 2. Prepare Vehicle
        // If driver chose a next stop, we can tell OR-Tools that the start_index is that stop, 
        // OR we just let OR-Tools decide and we manually move it to front.
        // High-level: if driver chose a stop, it IS the next stop.
        const vehicle = {
            max_weight: order.vehicle?.specs?.maxWeight || 10000,
            max_volume: order.vehicle?.specs?.cargoVolume || 50,
            start_index: 0 // Default to first location in matrix
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
    private mapOrToolsToVroomFormat(result: any, order: Order): any {
        if (!result || result.status !== 'success') return null

        const allStops = order.steps.flatMap(s => s.stops || [])
        const leg = order.leg

        const stops = result.stopOrder.map((s: any) => {
            const stopModel = allStops.find(sm => sm.id === s.stop_id)
            const meta = stopModel?.metadata || {}
            const routeInfo = meta.route_info || {}

            return {
                stopId: s.stop_id,
                execution_order: s.execution_order,
                display_order: stopModel?.displayOrder || 0,
                arrival: routeInfo.arrival_offset || 0,
                arrival_time: this.vroomService.formatSecondsToHm(routeInfo.arrival_offset || 0),
                duration: routeInfo.arrival_offset || 0,
                distance: routeInfo.distance_from_start || 0
            }
        })

        return {
            summary: {
                total_distance: result.totalDistance || leg?.distanceMeters || 0,
                total_duration: result.totalTime || leg?.durationSeconds || 0
            },
            geometry: leg?.geometry || { type: 'LineString', coordinates: [] },
            stops: stops,
            raw: result
        }
    }
}
