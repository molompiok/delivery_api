import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order/index'
import logger from '@adonisjs/core/services/logger'

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
    async index({ request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const { view } = request.qs()

            if (view === 'summary') {
                const orders = await this.orderService.listOrdersSummary(user.id)
                return response.ok(orders)
            }

            const orders = await this.orderService.listOrders(user.id)
            return response.ok(orders.map(o => o.serialize()))
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Show order details.
     */
    async show({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const { include } = request.qs()
            const includeArray = include ? include.split(',') : []

            logger.info({ orderId: params.id, userId: user.id, include: includeArray }, '[ORDERS_CONTROLLER] Show order')

            const order = await this.orderService.getOrderDetails(params.id, user.id, {
                include: includeArray
            })
            return response.ok(order)
        } catch (error: any) {
            logger.error({ orderId: params.id, err: error.message }, '[ORDERS_CONTROLLER] Order not found')
            return response.notFound({ message: error.message })
        }
    }

    /**
     * Show order route details (geometry + waypoints).
     */
    async route({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const { include, force, simplify, no_geo } = request.qs() // e.g., ?include=live,pending,trace&force=true&simplify=true

            const options = {
                live: !include || include.includes('live'),
                pending: include && include.includes('pending'),
                trace: !include || include.includes('trace'),
                force: force === 'true' || force === '1',
                simplify: simplify === 'true' || simplify === '1',
                no_geo: no_geo === 'true' || no_geo === '1',
            }

            const route = await this.orderService.getRoute(params.id, user.id, options)

            let actualTrace = null
            if (options.trace) {
                const RouteService = (await import('#services/route_service')).default
                const traceData = await RouteService.getActualTrace(params.id)
                actualTrace = {
                    geometry: {
                        type: 'LineString',
                        coordinates: traceData
                    }
                }
            }

            let navTrace = null
            if (include && include.includes('nav_trace')) {
                const NavigationService = (await import('#services/navigation_service')).default
                const { lat: latRaw, lng: lngRaw, calculate_nav } = request.qs()
                const lat = latRaw ? Number(latRaw) : NaN
                const lng = lngRaw ? Number(lngRaw) : NaN

                // logger.info({ orderId: params.id, lat, lng, calculate_nav }, '[ORDERS_CONTROLLER] Requesting nav_trace')

                if (!isNaN(lat) && !isNaN(lng)) {
                    const navData = await NavigationService.getNavTrace(
                        params.id,
                        lat,
                        lng,
                        calculate_nav === 'true'
                    )
                    if (navData && navData.geometry) {
                        navTrace = {
                            geometry: {
                                type: 'LineString',
                                coordinates: navData.geometry.coordinates
                            },
                            duration_seconds: navData.duration_seconds,
                            distance_meters: navData.distance_meters,
                            target_stop_id: navData.target_stop_id,
                            calculated_at: navData.calculated_at
                        }
                        logger.info({ orderId: params.id, points: navData.geometry.coordinates.length }, '[ORDERS_CONTROLLER] nav_trace generated 🚴')
                    } else {
                        logger.warn({ orderId: params.id }, '[ORDERS_CONTROLLER] nav_trace came back empty or null')
                    }
                } else {
                    logger.warn({ orderId: params.id, lat, lng }, '[ORDERS_CONTROLLER] Missing coordinates for nav_trace')
                }
            }

            return response.ok({
                ...route,
                actual_trace: actualTrace,
                nav_trace: navTrace
            })
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

    /**
     * Set the next stop for a driver.
     */
    async setNextStop({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const { stop_id } = request.all()
            await this.orderService.setNextStop(params.id, user.id, stop_id)
            return response.ok({ message: 'Next stop updated successfully' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Recalculate route on demand (e.g. from mobile app deviation detection).
     */
    async recalculate({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const { lat, lng } = request.all()
            const gps = (lat && lng) ? { lat: Number(lat), lng: Number(lng) } : undefined

            const route = await this.orderService.recalculateRoute(params.id, user.id, gps)
            return response.ok(route)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
