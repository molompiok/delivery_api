import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import redis from '@adonisjs/redis/services/main'
import Order from '#models/order'
import OrderStatusUpdated from '#events/order_status_updated'
import { inject } from '@adonisjs/core'
import StepService from './step_service.js'
import StopService from './stop_service.js'
import ActionService from './action_service.js'
import TransitItemService from './transit_item_service.js'
import OrderDraftService from './order_draft_service.js'
import LogisticsService from '../logistics_service.js'
import GeoService from '../geo_service.js'
import PricingService from '../pricing_service.js'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import PayloadMapper from './payload_mapper.js'

@inject()
export default class OrderService {
    constructor(
        protected stepService: StepService,
        protected stopService: StopService,
        protected actionService: ActionService,
        protected transitItemService: TransitItemService,
        protected orderDraftService: OrderDraftService
    ) { }

    /**
     * Lists orders for a client.
     */
    async listOrders(clientId: string) {
        return Order.query()
            .where('clientId', clientId)
            .where('isDeleted', false)
            .orderBy('createdAt', 'desc')
    }

    /**
     * Initiates a new empty order for a client.
     */
    async initiateOrder(clientId: string, metadata: any = {}, trx?: TransactionClientContract) {
        return this.orderDraftService.initiateOrder(clientId, metadata, trx)
    }

    /**
     * Submits a draft order to PENDING status.
     */
    async submitOrder(orderId: string, clientId: string, trx?: TransactionClientContract) {
        const order = await Order.query({ client: trx })
            .where('id', orderId)
            .where('clientId', clientId)
            .firstOrFail()

        order.status = 'PENDING'
        if (trx) {
            await order.useTransaction(trx).save()
        } else {
            await order.save()
        }

        emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
            orderId: order.id,
            status: order.status,
            clientId: order.clientId
        }))

        return order
    }

    /**
     * Gets full order details with all sub-components and applied shadows.
     */
    async getOrderDetails(orderId: string, clientId: string, options: any = {}) {
        return this.orderDraftService.getOrderDetails(orderId, clientId, options)
    }

    /**
     * Gets order route (geometry + waypoints).
     */
    async getRoute(orderId: string, clientId: string, options: any) {
        return this.orderDraftService.getRoute(orderId, clientId, options)
    }

    /**
     * Reverts all pending shadow changes for an order.
     */
    async revertPendingChanges(orderId: string, clientId: string) {
        const trx = await db.transaction()
        try {
            const order = await Order.query({ client: trx })
                .where('id', orderId)
                .where('clientId', clientId)
                .firstOrFail()

            await this.orderDraftService.revertPendingChanges(order.id, trx)

            await trx.commit()
            return order
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    async addStep(orderId: string, clientId: string, data: any, options: { recalculate?: boolean, trx?: TransactionClientContract } = {}) {
        const effectiveTrx = options.trx || await db.transaction()
        try {
            const res = await this.stepService.addStep(orderId, clientId, data, effectiveTrx)
            await redis.del(`order:pending_route:${orderId}`)
            const order = await this.orderDraftService.getOrderDetails(orderId, clientId, { trx: effectiveTrx, json: false }) as Order

            if (options.recalculate) {
                await this.orderDraftService.finalizeOrderAccounting(order, effectiveTrx)
                await order.useTransaction(effectiveTrx).save()
            }

            const virtualState = this.orderDraftService.buildVirtualState(order, { view: 'CLIENT' })
            res.validationErrors = LogisticsService.validateDraftConsistency(virtualState).errors

            if (!options.trx) await effectiveTrx.commit()
            return res
        } catch (error) {
            if (!options.trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async updateStep(stepId: string, clientId: string, data: any, options: { recalculate?: boolean, trx?: TransactionClientContract } = {}) {
        const effectiveTrx = options.trx || await db.transaction()
        try {
            const res = await this.stepService.updateStep(stepId, clientId, data, effectiveTrx)
            const step = await db.from('steps').useTransaction(effectiveTrx).where('id', stepId).first()
            await redis.del(`order:pending_route:${step.order_id}`)
            if (options.recalculate) {
                const order = await this.orderDraftService.getOrderDetails(step.order_id, clientId, { trx: effectiveTrx, json: false }) as Order
                await this.orderDraftService.finalizeOrderAccounting(order, effectiveTrx)
                await order.useTransaction(effectiveTrx).save()
            }
            if (!options.trx) await effectiveTrx.commit()
            return res
        } catch (error) {
            if (!options.trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async removeStep(stepId: string, clientId: string, options: { recalculate?: boolean, trx?: TransactionClientContract } = {}) {
        const effectiveTrx = options.trx || await db.transaction()
        try {
            const step = await db.from('steps').useTransaction(effectiveTrx).where('id', stepId).first()
            const orderId = step.order_id
            await redis.del(`order:pending_route:${orderId}`)
            const res = await this.stepService.removeStep(stepId, clientId, effectiveTrx)
            if (options.recalculate) {
                const order = await this.orderDraftService.getOrderDetails(orderId, clientId, { trx: effectiveTrx, json: false }) as Order
                await this.orderDraftService.finalizeOrderAccounting(order, effectiveTrx)
                await order.useTransaction(effectiveTrx).save()
            }
            if (!options.trx) await effectiveTrx.commit()
            return res
        } catch (error) {
            if (!options.trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async addStop(stepId: string, clientId: string, data: any, options: { recalculate?: boolean, trx?: TransactionClientContract } = {}) {
        const effectiveTrx = options.trx || await db.transaction()
        try {
            const res = await this.stopService.addStop(stepId, clientId, data, effectiveTrx)
            const step = await db.from('steps').useTransaction(effectiveTrx).where('id', stepId).first()
            await redis.del(`order:pending_route:${step.order_id}`)
            if (options.recalculate) {
                const order = await this.orderDraftService.getOrderDetails(step.order_id, clientId, { trx: effectiveTrx, json: false }) as Order
                await this.orderDraftService.finalizeOrderAccounting(order, effectiveTrx)
                await order.useTransaction(effectiveTrx).save()
            }
            if (!options.trx) await effectiveTrx.commit()
            return res
        } catch (error) {
            if (!options.trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async updateStop(stopId: string, clientId: string, data: any, options: { recalculate?: boolean, trx?: TransactionClientContract } = {}) {
        const effectiveTrx = options.trx || await db.transaction()
        try {
            const res = await this.stopService.updateStop(stopId, clientId, data, effectiveTrx)
            const stop = await db.from('stops').useTransaction(effectiveTrx).where('id', stopId).first()
            await redis.del(`order:pending_route:${stop.order_id}`)
            if (options.recalculate) {
                const order = await this.orderDraftService.getOrderDetails(stop.order_id, clientId, { trx: effectiveTrx, json: false }) as Order
                await this.orderDraftService.finalizeOrderAccounting(order, effectiveTrx)
                await order.useTransaction(effectiveTrx).save()
            }
            if (!options.trx) await effectiveTrx.commit()
            return res
        } catch (error) {
            if (!options.trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async removeStop(stopId: string, clientId: string, options: { recalculate?: boolean, trx?: TransactionClientContract } = {}) {
        const effectiveTrx = options.trx || await db.transaction()
        try {
            const stop = await db.from('stops').useTransaction(effectiveTrx).where('id', stopId).first()
            const orderId = stop.order_id
            await redis.del(`order:pending_route:${orderId}`)
            const res = await this.stopService.removeStop(stopId, clientId, effectiveTrx)
            if (options.recalculate) {
                const order = await this.orderDraftService.getOrderDetails(orderId, clientId, { trx: effectiveTrx, json: false }) as Order
                await this.orderDraftService.finalizeOrderAccounting(order, effectiveTrx)
                await order.useTransaction(effectiveTrx).save()
            }
            if (!options.trx) await effectiveTrx.commit()
            return res
        } catch (error) {
            if (!options.trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async addAction(stopId: string, clientId: string, data: any, options: { recalculate?: boolean, trx?: TransactionClientContract } = {}) {
        const effectiveTrx = options.trx || await db.transaction()
        try {
            const res = await this.actionService.addAction(stopId, clientId, data, effectiveTrx)
            const stop = await db.from('stops').useTransaction(effectiveTrx).where('id', stopId).first()
            await redis.del(`order:pending_route:${stop.order_id}`)
            if (options.recalculate) {
                const order = await this.orderDraftService.getOrderDetails(stop.order_id, clientId, { trx: effectiveTrx, json: false }) as Order
                await this.orderDraftService.finalizeOrderAccounting(order, effectiveTrx)
                await order.useTransaction(effectiveTrx).save()
            }
            if (!options.trx) await effectiveTrx.commit()
            return res
        } catch (error) {
            if (!options.trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async updateAction(actionId: string, clientId: string, data: any, options: { recalculate?: boolean, trx?: TransactionClientContract } = {}) {
        const effectiveTrx = options.trx || await db.transaction()
        try {
            const res = await this.actionService.updateAction(actionId, clientId, data, effectiveTrx)
            const action = await db.from('actions').useTransaction(effectiveTrx).where('id', actionId).first()
            await redis.del(`order:pending_route:${action.order_id}`)
            if (options.recalculate) {
                const order = await this.orderDraftService.getOrderDetails(action.order_id, clientId, { trx: effectiveTrx, json: false }) as Order
                await this.orderDraftService.finalizeOrderAccounting(order, effectiveTrx)
                await order.useTransaction(effectiveTrx).save()
            }
            if (!options.trx) await effectiveTrx.commit()
            return res
        } catch (error) {
            if (!options.trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async removeAction(actionId: string, clientId: string, options: { recalculate?: boolean, trx?: TransactionClientContract } = {}) {
        const effectiveTrx = options.trx || await db.transaction()
        try {
            const action = await db.from('actions').useTransaction(effectiveTrx).where('id', actionId).first()
            const orderId = action.order_id
            await redis.del(`order:pending_route:${orderId}`)
            const res = await this.actionService.removeAction(actionId, clientId, effectiveTrx)
            if (options.recalculate) {
                const order = await this.orderDraftService.getOrderDetails(orderId, clientId, { trx: effectiveTrx, json: false }) as Order
                await this.orderDraftService.finalizeOrderAccounting(order, effectiveTrx)
                await order.useTransaction(effectiveTrx).save()
            }
            if (!options.trx) await effectiveTrx.commit()
            return res
        } catch (error) {
            if (!options.trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async addTransitItem(orderId: string, clientId: string, data: any, trx?: TransactionClientContract) {
        return this.transitItemService.addTransitItem(orderId, clientId, data, trx)
    }

    async updateTransitItem(itemId: string, clientId: string, data: any, trx?: TransactionClientContract) {
        return this.transitItemService.updateTransitItem(itemId, clientId, data, trx)
    }

    /**
     * Updates top-level order metadata and optionally syncs structure if draft.
     */
    async updateOrder(orderId: string, clientId: string, payload: any, trx?: TransactionClientContract) {
        const hasComplexPayload = payload.steps || payload.transit_items
        const effectiveTrx = trx || await db.transaction()

        try {
            const order = await Order.query({ client: effectiveTrx })
                .where('id', orderId)
                .where('clientId', clientId)
                .forUpdate()
                .firstOrFail()

            if (payload.metadata) order.metadata = payload.metadata
            if (payload.ref_id) order.refId = payload.ref_id
            if (payload.assignment_mode) order.assignmentMode = payload.assignment_mode
            if (payload.priority) order.priority = payload.priority

            await order.useTransaction(effectiveTrx).save()

            if (hasComplexPayload) {
                if (order.status === 'DRAFT') {
                    // Clear existing structure before syncing for DRAFT orders
                    await db.from('actions').whereIn('stop_id', db.from('stops').whereIn('step_id', db.from('steps').where('order_id', orderId).select('id')).select('id')).useTransaction(effectiveTrx).delete()
                    await db.from('stops').whereIn('step_id', db.from('steps').where('order_id', orderId).select('id')).useTransaction(effectiveTrx).delete()
                    await db.from('steps').where('order_id', orderId).useTransaction(effectiveTrx).delete()
                    await db.from('transit_items').where('order_id', orderId).useTransaction(effectiveTrx).delete()
                }

                await this.syncOrderStructure(orderId, clientId, payload, effectiveTrx)
                await redis.del(`order:pending_route:${orderId}`)
            }

            if (!trx) await effectiveTrx.commit()
            return order
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Internal method to populate/sync steps, stops and actions.
     */
    private async syncOrderStructure(orderId: string, clientId: string, payload: any, trx: any) {
        const { items: mappedItems, map: idMap } = PayloadMapper.mapTransitItems(payload.transit_items || [])
        const mappedSteps = PayloadMapper.replaceReferenceIds(payload.steps || [], idMap)

        await this.transitItemService.createBulk(orderId, mappedItems, trx)

        if (mappedSteps) {
            for (const stepData of mappedSteps) {
                let stepRes: any
                if (stepData.id) {
                    stepRes = await this.stepService.updateStep(stepData.id, clientId, stepData, trx)
                } else {
                    stepRes = await this.stepService.addStep(orderId, clientId, stepData, trx)
                }

                if (stepData.stops) {
                    for (const stopData of stepData.stops) {
                        if (stopData.id) {
                            await this.stopService.updateStop(stopData.id, clientId, stopData, trx)
                        } else {
                            const targetStepId = stepRes.entity?.id || stepData.id
                            await this.stopService.addStop(targetStepId, clientId, stopData, trx)
                        }
                    }
                }
            }
        }
    }

    /**
     * Pushes pending updates to the live order.
     */
    async pushUpdates(orderId: string, clientId: string) {
        return this.orderDraftService.pushUpdates(orderId, clientId)
    }

    /**
     * Cancels a pending order.
     */
    async cancelOrder(orderId: string, clientId: string, reason: string) {
        const trx = await db.transaction()
        try {
            const order = await Order.query({ client: trx })
                .where('id', orderId)
                .where('clientId', clientId)
                .forUpdate()
                .first()

            if (!order) throw new Error('Order not found')
            if (order.status !== 'PENDING') throw new Error('Only pending orders can be cancelled')

            order.status = 'CANCELLED'
            order.statusHistory = [
                ...(order.statusHistory || []),
                {
                    status: 'CANCELLED',
                    timestamp: DateTime.now().toISO()!,
                    note: `Cancelled by client. Reason: ${reason}`
                }
            ]
            await order.useTransaction(trx).save()
            await trx.commit()

            emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                orderId: order.id,
                status: order.status,
                clientId: order.clientId
            }))

            return order
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Explicitly set the next stop for a driver (Driver Choice).
     */
    async setNextStop(orderId: string, clientId: string, stopId: string) {
        const trx = await db.transaction()
        try {
            const order = await Order.query({ client: trx })
                .where('id', orderId)
                .where('clientId', clientId)
                .preload('steps', (q) => q.preload('stops'))
                .firstOrFail()

            const allStops = order.steps.flatMap(s => s.stops || [])
            const targetStop = allStops.find(s => s.id === stopId)
            if (!targetStop) throw new Error('Stop not found in this order')

            const meta = order.metadata || {}
            meta.driver_choices = {
                ...(meta.driver_choices || {}),
                next_stop_id: stopId
            }
            order.metadata = meta
            await order.useTransaction(trx).save()

            // Trigger re-calculation
            const reloadedOrder = await Order.query({ client: trx })
                .where('id', orderId)
                .preload('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('display_order', 'asc').preload('address').preload('actions', (aq) => aq.preload('transitItem'))))
                .preload('transitItems')
                .firstOrFail()

            await this.orderDraftService.finalizeOrderAccounting(reloadedOrder, trx)

            await trx.commit()
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Re-calculates the remaining route from a specific GPS position.
     */
    async recalculateRoute(orderId: string, clientId: string, gps?: { lat: number, lng: number }) {
        const trx = await db.transaction()
        try {
            const order = await Order.query({ client: trx })
                .where('id', orderId)
                .where('clientId', clientId)
                .preload('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('display_order', 'asc').preload('address').preload('actions', (aq) => aq.preload('transitItem'))))
                .preload('transitItems')
                .preload('leg')
                .firstOrFail()

            const forcedStartLocation: [number, number] | undefined = gps ? [gps.lng, gps.lat] : undefined

            await this.orderDraftService.finalizeOrderAccounting(order, trx, { forcedStartLocation })
            await order.useTransaction(trx).save()

            await trx.commit()

            return this.orderDraftService.getRoute(orderId, clientId, { live: true, pending: false })
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Estimates an order before creation.
     */
    async getEstimation(payload: any) {
        const stops = payload.stops || []
        if (stops.length < 2) throw new Error('Need at least 2 stops for estimation')

        const routeDetails = await GeoService.calculateOptimizedRoute(stops)
        if (!routeDetails) throw new Error('Route calculation failed')

        const pricing = await PricingService.calculateFees(
            routeDetails.global_summary.total_distance_meters,
            routeDetails.global_summary.total_duration_seconds,
            [] // No items yet
        )

        return {
            route: routeDetails,
            pricing
        }
    }

    /**
     * Full order creation (Bulk).
     */
    async createOrder(clientId: string, payload: any, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const order = await this.initiateOrder(clientId, {}, effectiveTrx)
            await this.updateOrder(order.id, clientId, payload, effectiveTrx)
            if (!trx) await effectiveTrx.commit()
            return order
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Estimates a draft order (includes shadow changes).
     */
    async estimateDraft(orderId: string, clientId: string) {
        return this.orderDraftService.estimateDraft(orderId, clientId)
    }
}
