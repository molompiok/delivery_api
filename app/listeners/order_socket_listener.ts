import WsService from '#services/ws_service'
import logger from '@adonisjs/core/services/logger'
import OrderStatusUpdated from '#events/order_status_updated'
import StopStatusUpdated from '#events/stop_status_updated'
import ActionStatusUpdated from '#events/action_status_updated'
import OrderStructureChanged from '#events/order_structure_changed'
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

        // Notify the specific order room (for clients/tracking)
        WsService.emitToRoom(`orders:${payload.orderId}`, 'status_updated', payload)

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
                }
            }
        } catch (error) {
            logger.error({ error, orderId: payload.orderId }, 'Real-time (Order): Failed to notify fleet rooms')
        }
    }

    public async onStopStatusUpdated(event: StopStatusUpdated) {
        const payload = event.payload
        if (!payload?.stopId) return

        logger.info({ stopId: payload.stopId, status: payload.status }, 'Real-time (Stop): Notifying stop status update')

        // Notify the specific order room
        WsService.emitToRoom(`orders:${payload.orderId}`, 'stop_status_updated', payload)
    }

    public async onActionStatusUpdated(event: ActionStatusUpdated) {
        const payload = event.payload
        if (!payload?.actionId) return

        logger.info({ actionId: payload.actionId, status: payload.status }, 'Real-time (Action): Notifying action status update')

        // Notify the specific order room
        WsService.emitToRoom(`orders:${payload.orderId}`, 'action_status_updated', payload)
    }

    /**
     * Listen for structural changes (stops/actions) and notify the dashboard.
     */
    public async onOrderStructureChanged(event: OrderStructureChanged) {
        const { orderId, clientId } = event.payload

        logger.info({ orderId }, 'Real-time (Structure): Order structure changed, invalidating route and notifying dashboard')

        // 1. Invalidate Redis pending route cache
        await redis.del(`order:pending_route:${orderId}`)

        // 2. Notify Route Update (trigger map refresh)
        WsService.notifyOrderRouteUpdate(orderId, null, clientId)

        // 3. Notify Order Update (trigger data re-fetch)
        WsService.notifyOrderUpdate(orderId, clientId)
    }
}
