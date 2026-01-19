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
    }
}
