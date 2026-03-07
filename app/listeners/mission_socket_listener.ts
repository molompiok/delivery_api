import WsService from '#services/ws_service'
import NotificationService from '#services/notification_service'
import User from '#models/user'
import logger from '@adonisjs/core/services/logger'
import MissionOffered from '#events/mission_offered'

export default class MissionSocketListener {
    /**
     * Listen for new mission offers and notify the driver personal room.
     */
    public async onMissionOffered(event: MissionOffered) {
        const payload = event.payload

        if (!payload || !payload.orderId) {
            logger.warn({ event }, 'Real-time (Mission): Invalid mission offer event received')
            return
        }

        logger.info({ orderId: payload.orderId, driverId: payload.driverId }, 'Real-time (Mission): Notifying new mission offer')

        // Driver room (new + compatibility alias)
        WsService.emitToRoom(`driver:${payload.driverId}`, 'new_mission_offer', payload)
        WsService.emitToRoom(`drivers:${payload.driverId}`, 'new_mission_offer', payload)

        // Notify global admin/dashboard channel
        WsService.io?.emit('orders:new', {
            ...payload,
            id: payload.orderId,
            status: 'PENDING',
        })

        // Push notification to the offered driver
        const driver = await User.find(payload.driverId)
        if (!driver) {
            return
        }
        await NotificationService.sendMissionOffered(driver, {
            orderId: payload.orderId,
            expiresAt: payload.expiresAt,
        })
    }
}
