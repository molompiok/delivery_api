import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order_service'
import vine from '@vinejs/vine'

/**
 * Validates the universal order creation payload.
 */
const createOrderValidator = vine.compile(
    vine.object({
        steps: vine.array(
            vine.object({
                sequence: vine.number().optional(),
                linked: vine.boolean().optional(),
                stops: vine.array(
                    vine.object({
                        address_text: vine.string().trim().minLength(5).maxLength(255),
                        coordinates: vine.array(vine.number()).minLength(2).maxLength(2).optional(),
                        sequence: vine.number().optional(),
                        actions: vine.array(
                            vine.object({
                                type: vine.enum(['pickup', 'delivery', 'service'] as const),
                                transit_item_id: vine.string().trim().optional(),
                                quantity: vine.number().min(0.001).optional(),
                                service_time: vine.number().optional(),
                                confirmation_rules: vine.object({
                                    otp: vine.boolean().optional(),
                                    photo: vine.boolean().optional(),
                                    signature: vine.boolean().optional(),
                                    scan: vine.boolean().optional(),
                                }).optional(),
                                metadata: vine.any().optional(),
                            })
                        ).minLength(1)
                    })
                ).minLength(1)
            })
        ).minLength(1),
        transit_items: vine.array(
            vine.object({
                id: vine.string().trim(),
                product_id: vine.string().trim().optional(),
                name: vine.string().trim(),
                description: vine.string().trim().optional(),
                packaging_type: vine.enum(['box', 'fluid'] as const).optional(),
                weight_g: vine.number().optional(),
                dimensions: vine.object({
                    width_cm: vine.number().optional(),
                    height_cm: vine.number().optional(),
                    length_cm: vine.number().optional(),
                }).optional(),
                unitary_price: vine.number().optional(),
                metadata: vine.any().optional(),
            })
        ).optional(),
        ref_id: vine.string().trim().optional(),
        assignment_mode: vine.enum(['GLOBAL', 'INTERNAL', 'TARGET']).optional(),
        priority: vine.enum(['LOW', 'MEDIUM', 'HIGH'] as const).optional(),
        optimize_route: vine.boolean().optional(),
        allow_overload: vine.boolean().optional(),
        metadata: vine.any().optional(),
    })
)

/**
 * Validates the order cancellation payload.
 */
const cancelOrderValidator = vine.compile(
    vine.object({
        reason: vine.string().trim().minLength(5),
    })
)

@inject()
export default class OrdersController {
    constructor(protected orderService: OrderService) { }

    /**
     * Get an estimation for an order.
     */
    async estimate({ request, response }: HttpContext) {
        try {
            const payload = await request.validateUsing(createOrderValidator)
            const estimation = await this.orderService.getEstimation(payload)
            return response.ok(estimation)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Handle order creation.
     */
    async store({ request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const payload = await request.validateUsing(createOrderValidator)
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
            const { reason } = await request.validateUsing(cancelOrderValidator)
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
