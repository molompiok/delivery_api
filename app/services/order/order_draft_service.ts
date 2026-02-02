import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import Order from '#models/order'
import OrderLeg from '#models/order_leg'
import GeoService from '#services/geo_service'
import PricingService, { SimplePackageInfo } from '#services/pricing_service'
import OrderStatusUpdated from '#events/order_status_updated'
import DispatchService from '#services/dispatch_service'
import LogisticsService from '#services/logistics_service'
import { inject } from '@adonisjs/core'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import ActionService from './action_service.js'

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
        const order = await Order.create({
            clientId,
            status: 'DRAFT',
            assignmentMode: data.assignment_mode || 'GLOBAL',
            priority: data.priority || 'MEDIUM',
            refId: data.ref_id || null,
            assignmentAttemptCount: 0,
            metadata: data.metadata || {}
        }, { client: trx })
        return order
    }

    /**
     * Fetches detailed order with all relations preloaded.
     */
    async getOrderDetails(orderId: string, clientId: string) {
        const order = await Order.query()
            .where('id', orderId)
            .where('clientId', clientId)
            .preload('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('sequence', 'asc').preload('address').preload('actions', (aq) => aq.preload('transitItem'))))
            .preload('transitItems')
            .first()

        if (!order) {
            throw new Error('Order not found')
        }

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
            let filteredStops = filterDeleted(step.stops || [])
            if (options.view === 'CLIENT') {
                filteredStops = applyShadows(filteredStops)
            } else {
                filteredStops = filteredStops.filter(s => !s.isPendingChange)
            }
            filteredStops.sort((a, b) => a.sequence - b.sequence)

            return {
                id: step.id,
                sequence: step.sequence,
                linked: step.linked,
                stops: filteredStops.map(stop => {
                    let filteredActions = filterDeleted(stop.actions || [])
                    if (options.view === 'CLIENT') {
                        filteredActions = applyShadows(filteredActions)
                    } else {
                        filteredActions = filteredActions.filter(a => !a.isPendingChange)
                    }

                    return {
                        id: stop.id,
                        address_text: stop.address?.formattedAddress || '',
                        sequence: stop.sequence,
                        actions: filteredActions.map(action => ({
                            id: action.id,
                            type: action.type,
                            quantity: action.quantity,
                            transit_item_id: action.transitItemId
                        }))
                    }
                })
            }
        })

        const transitItems = order.transitItems ? order.transitItems.map(ti => ({
            id: ti.id,
            name: ti.name,
            weight_g: ti.weight ? ti.weight * 1000 : null,
            dimensions: ti.dimensions
        })) : []

        return {
            transit_items: transitItems,
            steps: steps
        }
    }

    /**
     * Estimates a draft order (route + pricing).
     */
    async estimateDraft(orderId: string, clientId: string) {
        const order = await this.getOrderDetails(orderId, clientId)
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
                weight_g: ti.weight ? ti.weight * 1000 : 0,
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

            const virtualState = this.buildVirtualState(order, { view: 'CLIENT' })
            const validation = LogisticsService.validateOrderConsistency(virtualState, 'SUBMIT')
            if (!validation.success) {
                const errorMessages = validation.errors.map(e => `[${e.path}] ${e.message}`).join(', ')
                throw new Error(`Order validation failed: ${errorMessages}`)
            }

            // Apply shadow changes (if any, though in DRAFT there shouldn't be much, but good practice)
            await this.applyShadowChanges(order.id, clientId, effectiveTrx)

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
    async applyShadowChanges(orderId: string, clientId: string, trx: TransactionClientContract) {
        // Re-fetch order with all shadows
        const order = await Order.query({ client: trx })
            .where('id', orderId)
            .preload('steps', (q) => q.preload('stops', (sq) => sq.preload('actions')))
            .first()

        if (!order) {
            throw new Error(`Order not found [ID: ${orderId}] during shadow merge`)
        }

        // 1. Merge Actions
        const allStops = order.steps.flatMap(s => s.stops || [])
        const allActions = allStops.flatMap(s => s.actions || [])

        for (const action of allActions) {
            if (action.isDeleteRequired) {
                await db.from('action_proofs').useTransaction(trx).where('action_id', action.id).delete()
                await action.useTransaction(trx).delete()
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
                    await original.useTransaction(trx).save()

                    // Move proofs
                    await db.from('action_proofs').useTransaction(trx).where('action_id', original.id).delete()
                    await db.from('action_proofs').useTransaction(trx).where('action_id', action.id).update({ action_id: original.id })
                }
                await action.useTransaction(trx).delete()
            }
        }

        // 2. Merge Stops
        for (const stop of allStops) {
            if (stop.isDeleteRequired) {
                // Actions should already be deleted above or cascade
                await stop.useTransaction(trx).delete()
                continue
            }
            if (stop.isPendingChange && stop.originalId) {
                const original = allStops.find(s => s.id === stop.originalId)
                if (original) {
                    original.sequence = stop.sequence
                    original.addressId = stop.addressId
                    original.metadata = stop.metadata
                    await original.useTransaction(trx).save()

                    // Relink actions to original stop
                    await db.from('actions').useTransaction(trx).where('stop_id', stop.id).update({ stop_id: original.id })
                }
                await stop.useTransaction(trx).delete()
            }
        }

        // 3. Merge Steps
        for (const step of order.steps) {
            if (step.isDeleteRequired) {
                await step.useTransaction(trx).delete()
                continue
            }
            if (step.isPendingChange && step.originalId) {
                const original = order.steps.find(s => s.id === step.originalId)
                if (original) {
                    original.sequence = step.sequence
                    original.linked = step.linked
                    original.metadata = step.metadata
                    await original.useTransaction(trx).save()

                    // Relink stops to original step
                    await db.from('stops').useTransaction(trx).where('step_id', step.id).update({ step_id: original.id })
                }
                await step.useTransaction(trx).delete()
            }
        }

        // 4. Reveal new components
        await db.from('steps').useTransaction(trx).where('order_id', orderId).where('is_pending_change', true).update({ is_pending_change: false })
        await db.from('stops').useTransaction(trx).where('order_id', orderId).where('is_pending_change', true).update({ is_pending_change: false })
        await db.from('actions').useTransaction(trx).where('order_id', orderId).where('is_pending_change', true).update({ is_pending_change: false })

        // 5. Cleanup orbits
        await this.cleanupOrphanedAddresses(orderId, trx)
    }

    /**
     * Deletes addresses that are no longer linked to any stop of this order.
     */
    async cleanupOrphanedAddresses(orderId: string, trx: TransactionClientContract) {
        // Find all address IDs currently linked to any stop of this order
        const activeStops = await db.from('stops').useTransaction(trx).where('order_id', orderId).select('address_id')
        const activeAddressIds = activeStops.map(s => s.address_id)

        // Find all addresses owned by this order
        const ownedAddresses = await db.from('addresses').useTransaction(trx).where('owner_id', orderId).where('owner_type', 'Order').select('id')

        for (const addr of ownedAddresses) {
            if (!activeAddressIds.includes(addr.id)) {
                await db.from('addresses').useTransaction(trx).where('id', addr.id).delete()
            }
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
                weight_g: ti.weight ? ti.weight * 1000 : 0,
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
}
