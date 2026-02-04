import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
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

@inject()
export default class OrderDraftService {
    constructor(
        protected dispatchService: DispatchService,
        protected actionService: ActionService
    ) { }

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

            // Create default step
            await Step.create({
                orderId: order.id,
                sequence: 0,
                linked: false,
                status: 'PENDING',
                metadata: {},
                isPendingChange: false
            }, { client: effectiveTrx })

            if (!trx) await effectiveTrx.commit()

            await order.load('steps')
            return order
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Fetches detailed order with all relations preloaded.
     */
    async getOrderDetails(orderId: string, clientId: string, trx?: TransactionClientContract) {
        const order = await Order.query({ client: trx })
            .where('id', orderId)
            .where('clientId', clientId)
            .preload('steps', (q) => q.orderBy('sequence', 'asc')
                .preload('stops', (sq) => sq.orderBy('sequence', 'asc')
                    .preload('address')
                    .preload('actions', (aq) => aq.preload('transitItem'))
                )
            )
            .preload('transitItems')
            .first()

        if (!order) {
            throw new Error('Order not found')
        }

        // Apply shadow filtering before returning
        const filterShadows = (list: any[]) => {
            const shadows = list.filter(item => item.isPendingChange)
            const originalsToReplace = shadows.map((s: any) => s.originalId).filter(Boolean)
            const activeItems = [
                ...list.filter(item => !item.isPendingChange && !originalsToReplace.includes(item.id)),
                ...shadows
            ]
            // Filter deletions (if any)
            return activeItems.filter(item => !item.isDeleteRequired)
        }

        const allStepsInOrder = order.steps || []
        const allStopsInOrder = allStepsInOrder.flatMap(s => s.stops || [])
        const allActionsInOrder = allStopsInOrder.flatMap(s => s.actions || [])

            ; (order as any).steps = filterShadows(allStepsInOrder)
                .sort((a: any, b: any) => a.sequence - b.sequence)
                .map(step => {
                    const conceptualStepId = step.isPendingChange ? step.originalId : step.id
                    const stepStops = allStopsInOrder.filter(s => s.stepId === conceptualStepId || s.stepId === step.id)

                        ; (step as any).stops = filterShadows(stepStops)
                            .sort((a: any, b: any) => a.sequence - b.sequence)
                            .map(stop => {
                                const conceptualStopId = stop.isPendingChange ? stop.originalId : stop.id
                                const stopActions = allActionsInOrder.filter(a => a.stopId === conceptualStopId || a.stopId === stop.id)

                                    ; (stop as any).actions = filterShadows(stopActions)
                                return stop
                            })
                    return step
                })

            ; (order as any).transitItems = filterShadows(order.transitItems || [])

        return order
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
            const originalsToReplace = shadows.map((s: any) => s.originalId).filter(Boolean)
            return [
                ...list.filter(item => !item.isPendingChange && !originalsToReplace.includes(item.id)),
                ...shadows
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
            stepStops.sort((a, b) => a.sequence - b.sequence)

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
                        address_text: stop.address?.formattedAddress || '',
                        sequence: stop.sequence,
                        is_pending_change: stop.isPendingChange,
                        is_delete_required: stop.isDeleteRequired,
                        actions: stopActions.map(action => ({
                            id: action.id,
                            type: action.type,
                            quantity: action.quantity,
                            transit_item_id: action.transitItemId,
                            is_pending_change: action.isPendingChange,
                            is_delete_required: action.isDeleteRequired
                        }))
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
        const order = await this.getOrderDetails(orderId, clientId, trx)
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
                .preload('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('sequence', 'asc').preload('address').preload('actions', (aq) => aq.preload('transitItem'))))
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
            const orderForValidation = await this.getOrderDetails(order.id, clientId, effectiveTrx)
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
            await order.load('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('sequence', 'asc').preload('address').preload('actions', (aq) => aq.preload('transitItem'))))

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

            await this.dispatchService.dispatch(order, effectiveTrx)

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
                        original.sequence = stop.sequence
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
    async finalizeOrderAccounting(order: Order, effectiveTrx: TransactionClientContract) {
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

        // Rebuild Legs
        await OrderLeg.query().useTransaction(effectiveTrx).where('orderId', order.id).delete()
        for (let i = 0; i < routeDetails.legs.length; i++) {
            const legData = routeDetails.legs[i]
            const fromWp = allStopsForRouting[i]
            const toWp = allStopsForRouting[i + 1]

            await OrderLeg.create({
                orderId: order.id,
                startAddressId: fromWp.address_id,
                endAddressId: toWp.address_id,
                distanceMeters: legData.distance_meters,
                durationSeconds: legData.duration_seconds,
                geometry: legData.geometry,
                sequence: i,
                status: 'PLANNED'
            }, { client: effectiveTrx })
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
                .preload('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('sequence', 'asc').preload('actions', (aq) => aq.preload('transitItem'))))
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
}
