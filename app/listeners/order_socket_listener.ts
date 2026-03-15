import WsService from '#services/ws_service'
import logger from '@adonisjs/core/services/logger'
import OrderStatusUpdated from '#events/order_status_updated'
import StopStatusUpdated from '#events/stop_status_updated'
import ActionStatusUpdated from '#events/action_status_updated'
import OrderStructureChanged from '#events/order_structure_changed'
import NotificationService from '#services/notification_service'
import redis from '@adonisjs/redis/services/main'

export default class OrderSocketListener {
    /**
     * Listen for order status updates and notify the order room.
     */
    public async onOrderStatusUpdated(event: OrderStatusUpdated) {
        const payload = event.payload

        if (!payload || !payload.orderId) {
            logger.warn({ event }, 'Real-time (Order): Invalid order status event received')
            return
        }

        logger.info({ orderId: payload.orderId, status: payload.status }, 'Real-time (Order): Notifying order status update')

        // Notify order rooms (legacy + current)
        WsService.emitToRoom(`orders:${payload.orderId}`, 'status_updated', payload)
        WsService.emitToRoom(`order:${payload.orderId}`, 'status_updated', payload)

        // Also notify the client's personal room
        WsService.emitToRoom(`clients:${payload.clientId}`, 'order_update', payload)

        // NEW: Notify the ETP fleet room
        try {
            const Order = (await import('#models/order')).default
            const order = await Order.find(payload.orderId)

            if (order) {
                // If it's an internal or target order, notify the client's company
                const User = (await import('#models/user')).default
                const client = await User.find(order.clientId)

                if (client?.effectiveCompanyId) {
                    WsService.emitToRoom(`fleet:${client.effectiveCompanyId}`, 'order_status_updated', {
                        ...payload,
                        assignmentMode: order.assignmentMode
                    })
                }

                // If a driver is assigned, also notify the driver's company (if different)
                if (order.driverId) {
                    const driver = await User.find(order.driverId)
                    if (driver?.companyId && driver.companyId !== client?.effectiveCompanyId) {
                        WsService.emitToRoom(`fleet:${driver.companyId}`, 'order_status_updated', payload)
                    }

                    // Push notification for impactful mission state changes
                    if (driver && payload.status === 'ACCEPTED') {
                        await NotificationService.sendOrderUpdate(driver, {
                            orderId: payload.orderId,
                            status: payload.status,
                            message: 'Mission acceptee. Vous etes desormais assigne.',
                        })
                    } else if (driver && ['CANCELLED', 'FAILED', 'DELIVERED', 'NO_DRIVER_AVAILABLE'].includes(payload.status)) {
                        await NotificationService.sendOrderUpdate(driver, {
                            orderId: payload.orderId,
                            status: payload.status,
                        })
                    }
                }
            }
        } catch (error) {
            logger.error({ error, orderId: payload.orderId }, 'Real-time (Order): Failed to notify fleet rooms')
        }
    }

    public async onStopStatusUpdated(event: StopStatusUpdated) {
        const payload = event.payload
        if (!payload?.stopId) return

        // Notify the specific order room
        WsService.emitToRoom(`order:${payload.orderId}`, 'stop_status_updated', payload)
        WsService.emitToRoom(`orders:${payload.orderId}`, 'stop_status_updated', payload)
    }

    public async onActionStatusUpdated(event: ActionStatusUpdated) {
        const payload = event.payload
        if (!payload?.actionId) return

        logger.info({ actionId: payload.actionId, status: payload.status }, 'Real-time (Action): Notifying action status update')

        // Notify the specific order room
        WsService.emitToRoom(`order:${payload.orderId}`, 'action_status_updated', payload)
        WsService.emitToRoom(`orders:${payload.orderId}`, 'action_status_updated', payload)
    }

    /**
     * Listen for structural changes (stops/actions) and notify the dashboard.
     */
    public async onOrderStructureChanged(event: OrderStructureChanged) {
        const { orderId, clientId, notifyDriver } = event.payload

        logger.info({ orderId }, 'Real-time (Structure): Order structure changed, invalidating route and notifying dashboard')

        // 1. Invalidate Redis pending route cache
        await redis.del(`order:pending_route:${orderId}`)

        // 2. Notify Route Update (trigger map refresh)
        WsService.notifyOrderRouteUpdate(orderId, null, clientId)

        // 3. Notify Order Update (trigger data re-fetch)
        WsService.notifyOrderUpdate(orderId, clientId)

        // 4. Push lightweight alert to driver ONLY when update is explicitly pushed
        if (!notifyDriver) {
            return
        }

        try {
            const Order = (await import('#models/order')).default
            const User = (await import('#models/user')).default
            const order = await Order.find(orderId)
            if (order?.driverId) {
                const driver = await User.find(order.driverId)
                if (driver) {
                    await NotificationService.sendOrderUpdate(driver, {
                        orderId,
                        status: order.status,
                        message: 'Mission mise a jour par le manager. Ouvrez l application pour synchroniser.',
                    })
                }
            }
        } catch (error) {
            logger.error({ error, orderId }, 'Real-time (Structure): Failed to notify driver push')
        }
    }
}
