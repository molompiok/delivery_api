import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order/index'
import logger from '@adonisjs/core/services/logger'
import {
    assertAllowedOrderAccessScope,
    getRequestedOrderAccessScope,
    getWriteTargetCompanyId,
    resolveOrderAccessContext,
} from '#utils/order_access'

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
    async submit({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            logger.info({ orderId: params.id, userId: user.id }, '[ORDERS_CONTROLLER] Submitting order')
            const order = await this.orderService.submitOrder(params.id, user.id, {
                targetCompanyId: getWriteTargetCompanyId(access),
            })
            logger.info({ orderId: params.id }, '[ORDERS_CONTROLLER] Order submitted successfully')
            return response.ok({
                message: 'Order submitted successfully',
                order: order.serialize()
            })
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            logger.error({ orderId: params.id, error: error.message }, '[ORDERS_CONTROLLER] Failed to submit order')
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Publish a draft or pending order.
     */
    async publish({ params, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, 'company')
            assertAllowedOrderAccessScope(access, ['company'])
            const order = await this.orderService.publishOrder(params.id, user.id, { targetCompanyId: getWriteTargetCompanyId(access) })
            return response.ok({
                message: 'Order published successfully',
                order: order.serialize()
            })
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Pushes pending shadow updates to the stable order view.
     */
    async pushUpdates({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            const order = await this.orderService.pushUpdates(params.id, user.id, { targetCompanyId: getWriteTargetCompanyId(access) })
            return response.ok({
                message: 'Order updates pushed successfully',
                order: order.serialize()
            })
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Reverts pending shadow updates.
     */
    async revertChanges({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            const order = await this.orderService.revertPendingChanges(params.id, user.id, { targetCompanyId: getWriteTargetCompanyId(access) })
            return response.ok({
                message: 'Order changes reverted successfully',
                order: order.serialize()
            })
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
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
            logger.info({ userId: user.id, payload }, '[ORDERS_CONTROLLER] Creating order (Bulk)')
            const order = await this.orderService.createOrder(user.id, payload)
            logger.info({ orderId: order.id }, '[ORDERS_CONTROLLER] Order created successfully')
            return response.created({
                message: 'Order created successfully',
                order: order.serialize()
            })
        } catch (error: any) {
            logger.error({ userId: auth.user?.id, error: error.message, stack: error.stack }, '[ORDERS_CONTROLLER] Failed to create order')
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Add a transit item to an order.
     */
    async addItem({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            const payload = request.all()
            const result = await this.orderService.addTransitItem(params.id, user.id, payload, {
                targetCompanyId: getWriteTargetCompanyId(access),
            })
            return response.created(result)
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }

    async estimateDraft({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            const estimation = await this.orderService.estimateDraft(params.id, user.id, { targetCompanyId: getWriteTargetCompanyId(access) })
            return response.ok(estimation)
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get order statistics for the dashboard.
     */
    async stats({ request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company', 'driver', 'admin'])
            const {
                withDailyCounts,
                withCompletionRate,
                withTemplates,
                withInProgress
            } = request.qs()

            const requestedFields: string[] = []
            if (withDailyCounts === 'true') requestedFields.push('dailyCounts')
            if (withCompletionRate === 'true') requestedFields.push('completionRate')
            if (withTemplates === 'true') requestedFields.push('templates')
            if (withInProgress === 'true') requestedFields.push('inProgress')

            const stats = await this.orderService.getOrderStats(access, requestedFields)
            return response.ok(stats)
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List client orders.
     */
    async index({ request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company', 'driver', 'admin'])
            const { view, page, perPage, search, status } = request.qs()

            if (view === 'summary') {
                const result = await this.orderService.listOrdersSummary(access, {
                    page: page ? Number(page) : undefined,
                    perPage: perPage ? Number(perPage) : undefined,
                    search: search || undefined,
                    status: status || undefined,
                })
                return response.ok(result)
            }

            const orders = await this.orderService.listOrders(access)
            return response.ok(orders.map(o => o.serialize()))
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Show order details.
     */
    async show({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company', 'driver', 'admin'])
            const includeArg = request.input('include')
            let includeArray: string[] = []
            if (Array.isArray(includeArg)) {
                includeArray = includeArg
            } else if (typeof includeArg === 'string') {
                includeArray = includeArg.split(',')
            }

            logger.info({ orderId: params.id, userId: user.id, include: includeArray }, '[ORDERS_CONTROLLER] Show order')

            const order = await this.orderService.getOrderDetails(params.id, access, {
                include: includeArray,
            })
            return response.ok(order)
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
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
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company', 'driver', 'admin'])
            const { include, force, simplify, no_geo } = request.qs() // e.g., ?include=live,pending,trace&force=true&simplify=true

            const options = {
                live: !include || include.includes('live'),
                pending: include && include.includes('pending'),
                trace: !include || include.includes('trace'),
                force: force === 'true' || force === '1',
                simplify: simplify === 'true' || simplify === '1',
                no_geo: no_geo === 'true' || no_geo === '1',
            }

            const route = await this.orderService.getRoute(params.id, access, options)

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
                let lat = latRaw ? Number(latRaw) : NaN
                let lng = lngRaw ? Number(lngRaw) : NaN

                // If coordinates are missing, try to get them from the active driver's state in Redis
                if (isNaN(lat) || isNaN(lng)) {
                    const order = await this.orderService.getOrderDetails(params.id, access)
                    if (order && order.driverId) {
                        const RedisService = (await import('#services/redis_service')).default
                        const driverState = await RedisService.getDriverState(order.driverId)
                        if (driverState && driverState.last_lat && driverState.last_lng) {
                            lat = driverState.last_lat
                            lng = driverState.last_lng
                            // logger.info({ orderId: params.id, driverId: order.driverId }, '[ORDERS_CONTROLLER] Using driver location from Redis for nav_trace')
                        }
                    }
                }

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
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.notFound({ message: error.message })
        }
    }

    /**
     * Handle order cancellation.
     */
    async cancel({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            const { reason } = request.all()
            const order = await this.orderService.cancelOrder(params.id, user.id, reason, {
                targetCompanyId: getWriteTargetCompanyId(access),
            })
            return response.ok({ message: 'Order cancelled successfully', order: order.serialize() })
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Handle order update.
     */
    async update({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            const payload = request.all()
            const order = await this.orderService.updateOrder(
                params.id,
                user.id,
                payload,
                undefined,
                getWriteTargetCompanyId(access)
            )
            return response.ok({
                message: 'Order updated successfully',
                order: order.serialize()
            })
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Set the next stop for a driver.
     */
    async setNextStop({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            const { stop_id } = request.all()
            await this.orderService.setNextStop(params.id, user.id, stop_id, {
                targetCompanyId: getWriteTargetCompanyId(access),
            })
            return response.ok({ message: 'Next stop updated successfully' })
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Recalculate route on demand (e.g. from mobile app deviation detection).
     */
    async recalculate({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company', 'driver', 'admin'])
            const { lat, lng } = request.all()
            const gps = (lat && lng) ? { lat: Number(lat), lng: Number(lng) } : undefined

            const route = await this.orderService.recalculateRoute(params.id, access, { gps })
            return response.ok(route)
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }
}
