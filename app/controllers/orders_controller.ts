import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order_service'

@inject()
export default class OrdersController {
    constructor(protected orderService: OrderService) { }

    /**
     * Get an estimation for an order.
     */
    async estimate({ request, response }: HttpContext) {
        try {
            const payload = request.all()
            const estimation = await this.orderService.getEstimation(payload)
            return response.ok(estimation)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Initiate a new DRAFT order.
     */
    async initiate({ response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const order = await this.orderService.initiateOrder(user.id)
            return response.created({
                message: 'Order draft initiated',
                order: order.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Submit a DRAFT order to make it PENDING.
     */
    async submit({ params, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const order = await this.orderService.submitOrder(params.id, user.id)
            return response.ok({
                message: 'Order submitted successfully',
                order: order.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Pushes pending shadow updates to the stable order view.
     */
    async pushUpdates({ params, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const order = await this.orderService.pushUpdates(params.id, user.id)
            return response.ok({
                message: 'Order updates pushed successfully',
                order: order.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Reverts pending shadow updates.
     */
    async revertChanges({ params, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const order = await this.orderService.revertPendingChanges(params.id, user.id)
            return response.ok({
                message: 'Order changes reverted successfully',
                order: order.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Handle order creation (Bulk).
     */
    async store({ request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const payload = request.all()
            const order = await this.orderService.createOrder(user.id, payload)
            return response.created({
                message: 'Order created successfully',
                order: order.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Add a transit item to an order.
     */
    async addItem({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const payload = request.all()
            const result = await this.orderService.addTransitItem(params.id, user.id, payload)
            return response.created(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async estimateDraft({ params, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const estimation = await this.orderService.estimateDraft(params.id, user.id)
            return response.ok(estimation)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List client orders.
     */
    async index({ response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const orders = await this.orderService.listOrders(user.id)
            return response.ok(orders.map(o => o.serialize()))
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Show order details.
     */
    async show({ params, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const order = await this.orderService.getOrderDetails(params.id, user.id)
            return response.ok(order.serialize())
        } catch (error: any) {
            return response.notFound({ message: error.message })
        }
    }

    /**
     * Handle order cancellation.
     */
    async cancel({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const { reason } = request.all()
            const order = await this.orderService.cancelOrder(params.id, user.id, reason)
            return response.ok({ message: 'Order cancelled successfully', order: order.serialize() })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Handle order update.
     */
    async update({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const payload = request.all()
            const order = await this.orderService.updateOrder(params.id, user.id, payload)
            return response.ok({
                message: 'Order updated successfully',
                order: order.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
