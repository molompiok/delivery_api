import WsService from '#services/ws_service'
import logger from '@adonisjs/core/services/logger'
import OrderStatusUpdated from '#events/order_status_updated'

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
}
