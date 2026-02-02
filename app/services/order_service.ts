import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import Order from '#models/order'
import OrderStatusUpdated from '#events/order_status_updated'
import { inject } from '@adonisjs/core'
import ActionService from './order/action_service.js'
import StopService from './order/stop_service.js'
import StepService from './order/step_service.js'
import TransitItemService from './order/transit_item_service.js'
import OrderDraftService from './order/order_draft_service.js'
import { createOrderSchema } from '../validators/order_validator.js'
import vine from '@vinejs/vine'
import wsService from '#services/ws_service'
import LogisticsService from '#services/logistics_service'

@inject()
export default class OrderService {
    constructor(
        protected actionService: ActionService,
        protected stopService: StopService,
        protected stepService: StepService,
        protected transitItemService: TransitItemService,
        protected orderDraftService: OrderDraftService
    ) { }

    /**
     * Legacy/Helper for estimations.
     */
    async getEstimation(_payload: any) {
        // Implementation for simple estimation from waypoints
        // Currently delegating to a dummy or needs fresh implementation if needed for external API
        return { message: "Estimation logic refactoring in progress" }
    }

    /**
     * Creates a new universal delivery order (Bulk flow).
     * Now a wrapper around atomic operations.
     */
    async createOrder(clientId: string, payload: any) {
        const validatedPayload = await vine.validate({ schema: createOrderSchema, data: payload })
        const trx = await db.transaction()
        try {
            // 1. Initiate Draft
            let order;
            try {
                order = await this.orderDraftService.initiateOrder(clientId, validatedPayload, trx)
            } catch (e) {
                throw new Error(`Failed to initiate order draft: ${e.message}`)
            }

            // 2. Create TransitItems
            let itemMap;
            try {
                itemMap = await this.transitItemService.createBulk(order.id, validatedPayload.transit_items || [], trx)
            } catch (e) {
                throw new Error(`Failed to create transit items: ${e.message}`)
            }

            // 3. Process Steps, Stops and Actions
            for (let i = 0; i < validatedPayload.steps.length; i++) {
                const stepData = validatedPayload.steps[i]
                let stepRes;
                try {
                    stepRes = await this.stepService.addStep(order.id, clientId, stepData, trx)
                } catch (e) {
                    throw new Error(`Failed to add step at index ${i}: ${e.message}`)
                }

                for (let j = 0; j < stepData.stops.length; j++) {
                    const stopData = stepData.stops[j]
                    let stopRes;
                    try {
                        stopRes = await this.stopService.addStop(stepRes.entity!.id, clientId, stopData, trx)
                    } catch (e) {
                        throw new Error(`Failed to add stop at index ${j} for step ${i}: ${e.message}`)
                    }

                    for (let k = 0; k < stopData.actions.length; k++) {
                        const actionData = stopData.actions[k]
                        const actionPayload = { ...actionData }
                        if (actionPayload.transit_item_id) {
                            actionPayload.transit_item_id = itemMap.get(actionPayload.transit_item_id)?.id
                        }
                        try {
                            await this.actionService.addAction(stopRes.entity!.id, clientId, actionPayload, trx)
                        } catch (e) {
                            throw new Error(`Failed to add action at index ${k} for stop ${j}, step ${i}: ${e.message}`)
                        }
                    }
                }
            }

            // 4. Submit Order (Final Validation + Routing + Pricing + Dispatch)
            let finalizedOrder;
            try {
                finalizedOrder = await this.orderDraftService.submitOrder(order.id, clientId, trx)
            } catch (e) {
                throw new Error(`Failed to finalize order: ${e.message}`)
            }

            await trx.commit()
            return finalizedOrder
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

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
     * Facade methods for backward compatibility or controller use
     */
    async initiateOrder(clientId: string, data?: any) {
        return this.orderDraftService.initiateOrder(clientId, data)
    }

    async getOrderDetails(orderId: string, clientId: string) {
        return this.orderDraftService.getOrderDetails(orderId, clientId)
    }

    async submitOrder(orderId: string, clientId: string) {
        return this.orderDraftService.submitOrder(orderId, clientId)
    }

    async estimateDraft(orderId: string, clientId: string) {
        return this.orderDraftService.estimateDraft(orderId, clientId)
    }

    async pushUpdates(orderId: string, clientId: string) {
        const trx = await db.transaction()
        try {
            const order = await this.orderDraftService.getOrderDetails(orderId, clientId)

            // 1. Validate the shadow state (intended final state)
            const virtualState = this.orderDraftService.buildVirtualState(order, { view: 'CLIENT' })
            const validation = LogisticsService.validateOrderConsistency(virtualState, 'SUBMIT')
            if (!validation.success) {
                const errorMessages = validation.errors.map(e => `[${e.path}] ${e.message}`).join(', ')
                throw new Error(`Proposed changes are invalid: ${errorMessages}`)
            }

            // 2. Apply Shadows
            await this.orderDraftService.applyShadowChanges(orderId, clientId, trx)

            // 3. Re-calculate accounting (routing, pricing, legs)
            // Re-fetch to get merged state with relations
            const mergedOrder = await Order.query({ client: trx })
                .where('id', orderId)
                .preload('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('sequence', 'asc').preload('address').preload('actions', (aq) => aq.preload('transitItem'))))
                .preload('transitItems')
                .firstOrFail()

            await this.orderDraftService.finalizeOrderAccounting(mergedOrder, trx)
            await mergedOrder.useTransaction(trx).save()

            await trx.commit()

            // 4. Notifications
            if (mergedOrder.driverId) {
                wsService.notifyDriverRouteUpdate(mergedOrder.driverId, mergedOrder.id)
            }

            return mergedOrder
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    async addStep(orderId: string, clientId: string, data: any, options: { recalculate?: boolean } = {}) {
        const res = await this.stepService.addStep(orderId, clientId, data)
        const order = await this.orderDraftService.getOrderDetails(orderId, clientId)

        if (options.recalculate) {
            await this.orderDraftService.finalizeOrderAccounting(order, await db.transaction()) // Use a temp transaction or just db
        }

        const virtualState = this.orderDraftService.buildVirtualState(order, { view: 'CLIENT' })
        res.validationErrors = LogisticsService.validateDraftConsistency(virtualState).errors
        return res
    }

    async updateStep(stepId: string, clientId: string, data: any, options: { recalculate?: boolean } = {}) {
        const res = await this.stepService.updateStep(stepId, clientId, data)
        if (options.recalculate) {
            const step = await db.from('steps').where('id', stepId).first()
            const order = await this.orderDraftService.getOrderDetails(step.order_id, clientId)
            await this.orderDraftService.finalizeOrderAccounting(order, await db.transaction())
        }
        return res
    }

    async removeStep(stepId: string, clientId: string, options: { recalculate?: boolean } = {}) {
        const step = await db.from('steps').where('id', stepId).first()
        const orderId = step.order_id
        const res = await this.stepService.removeStep(stepId, clientId)
        if (options.recalculate) {
            const order = await this.orderDraftService.getOrderDetails(orderId, clientId)
            await this.orderDraftService.finalizeOrderAccounting(order, await db.transaction())
        }
        return res
    }

    async addStop(stepId: string, clientId: string, data: any, options: { recalculate?: boolean } = {}) {
        const res = await this.stopService.addStop(stepId, clientId, data)
        if (options.recalculate) {
            const step = await db.from('steps').where('id', stepId).first()
            const order = await this.orderDraftService.getOrderDetails(step.order_id, clientId)
            await this.orderDraftService.finalizeOrderAccounting(order, await db.transaction())
        }
        return res
    }

    async updateStop(stopId: string, clientId: string, data: any, options: { recalculate?: boolean } = {}) {
        const res = await this.stopService.updateStop(stopId, clientId, data)
        if (options.recalculate) {
            const stop = await db.from('stops').where('id', stopId).first()
            const order = await this.orderDraftService.getOrderDetails(stop.order_id, clientId)
            await this.orderDraftService.finalizeOrderAccounting(order, await db.transaction())
        }
        return res
    }

    async removeStop(stopId: string, clientId: string, options: { recalculate?: boolean } = {}) {
        const stop = await db.from('stops').where('id', stopId).first()
        const orderId = stop.order_id
        const res = await this.stopService.removeStop(stopId, clientId)
        if (options.recalculate) {
            const order = await this.orderDraftService.getOrderDetails(orderId, clientId)
            await this.orderDraftService.finalizeOrderAccounting(order, await db.transaction())
        }
        return res
    }

    async addAction(stopId: string, clientId: string, data: any, options: { recalculate?: boolean } = {}) {
        const res = await this.actionService.addAction(stopId, clientId, data)
        if (options.recalculate) {
            const stop = await db.from('stops').where('id', stopId).first()
            const order = await this.orderDraftService.getOrderDetails(stop.order_id, clientId)
            await this.orderDraftService.finalizeOrderAccounting(order, await db.transaction())
        }
        return res
    }

    async updateAction(actionId: string, clientId: string, data: any, options: { recalculate?: boolean } = {}) {
        const res = await this.actionService.updateAction(actionId, clientId, data)
        if (options.recalculate) {
            const action = await db.from('actions').where('id', actionId).first()
            const order = await this.orderDraftService.getOrderDetails(action.order_id, clientId)
            await this.orderDraftService.finalizeOrderAccounting(order, await db.transaction())
        }
        return res
    }

    async removeAction(actionId: string, clientId: string, options: { recalculate?: boolean } = {}) {
        const action = await db.from('actions').where('id', actionId).first()
        const orderId = action.order_id
        const res = await this.actionService.removeAction(actionId, clientId)
        if (options.recalculate) {
            const order = await this.orderDraftService.getOrderDetails(orderId, clientId)
            await this.orderDraftService.finalizeOrderAccounting(order, await db.transaction())
        }
        return res
    }

    async addTransitItem(orderId: string, clientId: string, data: any) {
        return this.transitItemService.addTransitItem(orderId, clientId, data)
    }

    async updateOrder(orderId: string, clientId: string, payload: any) {
        const order = await this.orderDraftService.getOrderDetails(orderId, clientId)
        const trx = await db.transaction()
        try {
            if (payload.metadata) order.metadata = payload.metadata
            if (payload.ref_id) order.refId = payload.ref_id
            await order.useTransaction(trx).save()
            await trx.commit()
            return order
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    async cancelOrder(orderId: string, clientId: string, _reason: string) {
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
                    note: `Cancelled by client. Reason: ${_reason}`
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
}
