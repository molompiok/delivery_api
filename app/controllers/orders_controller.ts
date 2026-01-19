import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order_service'
import vine from '@vinejs/vine'
import Order from '#models/order'

/**
 * Validates the order creation payload.
 */
const createOrderValidator = vine.compile(
    vine.object({
        waypoints: vine.array(
            vine.object({
                address_text: vine.string().trim().minLength(5).maxLength(255),
                type: vine.enum(['pickup', 'delivery'] as const),
                contact_name: vine.string().trim().optional(),
                contact_phone: vine.string().trim().optional(),
                note: vine.string().trim().optional(),
                // Package infos are related to pickup waypoints
                package_infos: vine.array(
                    vine.object({
                        name: vine.string().trim(),
                        description: vine.string().trim().optional(),
                        quantity: vine.number().min(1).optional(),
                        dimensions: vine.object({
                            weight_g: vine.number().optional(),
                            width_cm: vine.number().optional(),
                            height_cm: vine.number().optional(),
                            length_cm: vine.number().optional(),
                        }).optional(),
                        mention_warning: vine.enum(['fragile', 'liquid', 'flammable', 'none']).optional(),
                    })
                ).optional(),
            })
        ).minLength(2),
        ref_id: vine.string().trim().optional(),
        assignment_mode: vine.enum(['GLOBAL', 'INTERNAL', 'TARGET']).optional(),
        priority: vine.enum(['low', 'medium', 'high'] as const).optional(),
        note: vine.string().trim().optional(),
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
     * Handle order creation.
     */
    async store({ request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const payload = await request.validateUsing(createOrderValidator)

        try {
            const order = await this.orderService.createOrder(user.id, {
                ...payload,
                ref_id: payload.ref_id,
                assignment_mode: payload.assignment_mode,
            })
            return response.created({
                message: 'Order created successfully',
                order: order.serialize()
            })
        } catch (error) {
            return response.internalServerError({
                message: 'Order creation failed',
                error: error.message
            })
        }
    }

    /**
     * List client orders.
     */
    async index({ response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const orders = await Order.query()
            .where('clientId', user.id)
            .preload('legs')
            .preload('packages')
            .orderBy('createdAt', 'desc')

        return response.ok(orders.map(o => o.serialize()))
    }

    /**
     * Show order details.
     */
    async show({ params, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const order = await Order.query()
            .where('id', params.id)
            .andWhere('clientId', user.id)
            .preload('legs')
            .preload('packages')
            .preload('pickupAddress')
            .preload('deliveryAddress')
            .first()

        if (!order) {
            return response.notFound({ message: 'Order not found' })
        }

        return response.ok(order.serialize())
    }

    /**
     * Handle order cancellation.
     */
    async cancel({ params, request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        await request.validateUsing(cancelOrderValidator)

        const order = await Order.query()
            .where('id', params.id)
            .andWhere('clientId', user.id)
            .first()

        if (!order) {
            return response.notFound({ message: 'Order not found' })
        }

        if (order.status !== 'PENDING') {
            return response.badRequest({ message: 'Only pending orders can be cancelled' })
        }

        order.status = 'CANCELLED'
        // In a more complete implementation, we might want to log the reason or notify driver
        await order.save()

        return response.ok({ message: 'Order cancelled successfully', order: order.serialize() })
    }
}
