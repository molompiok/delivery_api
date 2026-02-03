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
import PayloadMapper from './order/payload_mapper.js'

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
            const order = await this.orderDraftService.initiateOrder(clientId, validatedPayload, trx)

            // 2. Sync Structure (Steps, Stops, Actions, Items)
            await this.syncOrderStructure(order.id, clientId, validatedPayload, trx)

            // 3. Submit Order (Final Validation + Routing + Pricing + Dispatch)
            const finalizedOrder = await this.orderDraftService.submitOrder(order.id, clientId, trx)

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
            if (!validation.success || (validation.warnings && validation.warnings.length > 0)) {
                const errors = validation.errors.map(e => `[ERROR] [${e.path}] ${e.message}`)
                const warnings = (validation.warnings || []).map(w => `[WARNING] [${w.path}] ${w.message}`)
                const allMessages = [...errors, ...warnings].join(', ')
                throw new Error(`Proposed changes are invalid: ${allMessages}`)
            }

            // 2. Apply Shadows
            await this.orderDraftService.applyShadowChanges(orderId, trx)

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

    async updateTransitItem(itemId: string, clientId: string, data: any) {
        return this.transitItemService.updateTransitItem(itemId, clientId, data)
    }

    async updateOrder(orderId: string, clientId: string, payload: any) {
        // If payload contains steps or transit_items, we use the complex sync logic
        const hasComplexPayload = payload.steps || payload.transit_items

        const trx = await db.transaction()
        try {
            const order = await Order.query({ client: trx })
                .where('id', orderId)
                .where('clientId', clientId)
                .forUpdate()
                .firstOrFail()

            if (payload.metadata) order.metadata = payload.metadata
            if (payload.ref_id) order.refId = payload.ref_id
            if (payload.assignment_mode) order.assignmentMode = payload.assignment_mode
            if (payload.priority) order.priority = payload.priority

            await order.useTransaction(trx).save()

            if (hasComplexPayload) {
                // For updates, we clear existing structure before syncing if the order is still a DRAFT
                if (order.status === 'DRAFT') {
                    await db.from('actions').whereIn('stop_id', db.from('stops').whereIn('step_id', db.from('steps').where('order_id', orderId).select('id')).select('id')).useTransaction(trx).delete()
                    await db.from('stops').whereIn('step_id', db.from('steps').where('order_id', orderId).select('id')).useTransaction(trx).delete()
                    await db.from('steps').where('order_id', orderId).useTransaction(trx).delete()
                    await db.from('transit_items').where('order_id', orderId).useTransaction(trx).delete()
                } else {
                    // If it's not a draft, we might want to use the "shadow" system in the future
                    // For now, let's keep it simple for the unified experience
                }

                await this.syncOrderStructure(orderId, clientId, payload, trx)
            }

            await trx.commit()
            return order
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Internal method to populate/sync steps, stops and actions.
     */
    private async syncOrderStructure(orderId: string, clientId: string, payload: any, trx: any) {
        // 1. Prepare IDs and Structure using PayloadMapper
        const { items: mappedItems, map: idMap } = PayloadMapper.mapTransitItems(payload.transit_items || [])
        // Replace user IDs with system UUIDs in the steps structure
        const mappedSteps = PayloadMapper.replaceReferenceIds(payload.steps || [], idMap)

        // 2. Create TransitItems (using the pre-generated UUIDs)
        await this.transitItemService.createBulk(orderId, mappedItems, trx)

        // 3. Create Steps (stops and actions are nested)
        if (mappedSteps) {
            for (const stepData of mappedSteps) {
                const stepRes = await this.stepService.addStep(orderId, clientId, stepData, trx)

                if (stepData.stops) {
                    for (const stopData of stepData.stops) {
                        // IDs are already mapped in stopData.actions
                        await this.stopService.addStop(stepRes.entity!.id, clientId, stopData, trx)
                    }
                }
            }
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
