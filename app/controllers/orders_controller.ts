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
                waypoint_sequence: vine.number().optional(),
                coordinates: vine.array(vine.number()).minLength(2).maxLength(2).optional(),
                contact_name: vine.string().trim().optional(),
                contact_phone: vine.string().trim().optional(),
                note: vine.string().trim().optional(),
                // Package infos can be tied to a specific waypoint
                package_infos: vine.array(
                    vine.object({
                        name: vine.string().trim(),
                        description: vine.string().trim().optional(),
                        quantity: vine.number().min(1).optional(),
                        delivery_waypoint_sequence: vine.number().optional(),
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
        priority: vine.enum(['LOW', 'MEDIUM', 'HIGH'] as const).optional(),
        optimize_route: vine.boolean().optional(),
        note: vine.string().trim().optional(),
    })
)

/**
 * Validates the complex order creation payload.
 */
const createComplexOrderValidator = vine.compile(
    vine.object({
        shipments: vine.array(
            vine.object({
                pickup: vine.object({
                    address_text: vine.string().trim(),
                    coordinates: vine.array(vine.number()).minLength(2).maxLength(2),
                    service_time: vine.number().optional()
                }),
                delivery: vine.object({
                    address_text: vine.string().trim(),
                    coordinates: vine.array(vine.number()).minLength(2).maxLength(2),
                    service_time: vine.number().optional()
                }),
                package: vine.object({
                    name: vine.string().trim(),
                    weight: vine.number().optional()
                }).optional()
            })
        ).optional(),
        jobs: vine.array(
            vine.object({
                address_text: vine.string().trim(),
                coordinates: vine.array(vine.number()).minLength(2).maxLength(2),
                service_time: vine.number().optional()
            })
        ).optional(),
        ref_id: vine.string().trim().optional(),
        assignment_mode: vine.enum(['GLOBAL', 'INTERNAL', 'TARGET']).optional(),
        logic_pattern: vine.string().optional(),
        priority: vine.enum(['LOW', 'MEDIUM', 'HIGH'] as const).optional()
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
        const payload = await request.validateUsing(createOrderValidator)
        try {
            const estimation = await this.orderService.getEstimation(payload)
            return response.ok(estimation)
        } catch (error) {
            return response.internalServerError({
                message: 'Estimation failed',
                error: error.message
            })
        }
    }

    /**
     * Handle order creation.
     */
    async store({ request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const payload = await request.validateUsing(createOrderValidator)

        try {
            const order = await this.orderService.createOrder(user.id, payload)
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
     * Handle complex order creation (Cas G).
     */
    async storeComplex({ request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const payload = await request.validateUsing(createComplexOrderValidator)

        try {
            const order = await this.orderService.createComplexOrder(user.id, payload)
            return response.created({
                message: 'Complex order created successfully',
                order: order.serialize()
            })
        } catch (error) {
            return response.internalServerError({
                message: 'Complex order creation failed',
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
            .preload('pickupAddress')
            .preload('deliveryAddress')
            .orderBy('createdAt', 'desc')

        return response.ok(orders.map(o => o.serialize()))
    }

    /**
     * Show order details.
     */
    async show({ params, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const order = await Order.query()
                .where('id', params.id)
                .andWhere('clientId', user.id)
                .preload('legs')
                .preload('packages')
                .preload('pickupAddress')
                .preload('deliveryAddress')
                .preload('tasks', (q) => q.preload('address'))
                .preload('shipments')
                .preload('jobs')
                .preload('driver', (q) => q.preload('driverSetting'))
                .first()

            if (!order) {
                return response.notFound({ message: 'Order not found' })
            }

            return response.ok(order.serialize())
        } catch (error) {
            console.error('Failed to fetch order details:', error);
            return response.internalServerError({
                message: 'Failed to fetch order details',
                error: error.message
            });
        }
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
