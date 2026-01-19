import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import Order from '#models/order'
import Mission from '#models/mission'
import OrderStatusUpdated from '#events/order_status_updated'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

export default class MissionService {
    /**
     * Driver accepts a mission.
     */
    async acceptMission(driverId: string, orderId: string) {
        const trx = await db.transaction()

        try {
            const order = await Order.find(orderId, { client: trx })
            if (!order || order.status !== 'PENDING') {
                throw new Error('Mission is no longer available')
            }

            // Document Compliance Check
            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
            const DriverSetting = (await import('#models/driver_setting')).default
            const ds = await DriverSetting.findBy('userId', driverId)

            if (ds?.currentCompanyId) {
                const cds = await CompanyDriverSetting.query()
                    .where('companyId', ds.currentCompanyId)
                    .where('driverId', driverId)
                    .first()

                if (cds && cds.docsStatus !== 'APPROVED') {
                    throw new Error('Votre dossier est incomplet ou contient des documents rejetés. Veuillez régulariser votre situation pour accepter des missions.')
                }
            }

            // Assign driver and update status
            order.driverId = driverId
            order.offeredDriverId = null
            order.status = 'ACCEPTED'
            await order.useTransaction(trx).save()

            // Create or update Mission model
            let mission = await Mission.query({ client: trx }).where('orderId', orderId).first()
            if (!mission) {
                mission = new Mission()
                mission.orderId = orderId
            }
            mission.driverId = driverId
            mission.status = 'ASSIGNED'
            mission.startAt = DateTime.now()
            await mission.useTransaction(trx).save()

            // Update driver availability if needed (simplified for now)
            // In a real app, we might check how many active missions they have

            await trx.commit()

                // Emit Real-time Event
                ; (emitter as any).emit(new OrderStatusUpdated({
                    orderId: order.id,
                    status: order.status,
                    clientId: order.clientId
                }))

            return order
        } catch (error) {
            await trx.rollback()
            logger.error({ err: error }, 'Mission acceptance failed')
            throw error
        }
    }

    /**
     * Driver refuses a mission.
     */
    async refuseMission(driverId: string, orderId: string) {
        const order = await Order.find(orderId)
        if (order && order.offeredDriverId === driverId) {
            order.offeredDriverId = null
            order.offerExpiresAt = null
            await order.save()
        }
        return true
    }

    /**
     * Update mission status.
     */
    async updateStatus(orderId: string, driverId: string, status: string, _options: { latitude?: number, longitude?: number, reason?: string }) {
        const trx = await db.transaction()

        try {
            const order = await Order.query({ client: trx })
                .where('id', orderId)
                .andWhere('driverId', driverId)
                .first()

            if (!order) {
                throw new Error('Order not found or not assigned to you')
            }

            // Validate transitions (simplified)
            const allowedTransitions: Record<string, string[]> = {
                'ACCEPTED': ['AT_PICKUP', 'CANCELLED'],
                'AT_PICKUP': ['COLLECTED', 'FAILED'],
                'COLLECTED': ['AT_DELIVERY', 'FAILED'],
                'AT_DELIVERY': ['DELIVERED', 'FAILED'],
                'DELIVERED': [],
                'FAILED': [],
                'CANCELLED': []
            }

            if (!allowedTransitions[order.status]?.includes(status)) {
                throw new Error(`Invalid status transition from ${order.status} to ${status}`)
            }

            order.status = status as any
            await order.useTransaction(trx).save()

            // Update Mission model
            const mission = await Mission.query({ client: trx }).where('orderId', orderId).first()
            if (mission) {
                if (status === 'COLLECTED') mission.status = 'IN_PROGRESS'
                if (status === 'DELIVERED') {
                    mission.status = 'COMPLETED'
                    mission.completedAt = DateTime.now()
                }
                if (status === 'FAILED') mission.status = 'FAILED'
                await mission.useTransaction(trx).save()
            }

            // Log the event (Audit log could go here)
            logger.info({ orderId, status, driverId }, 'Mission status updated')

            await trx.commit()

                // Emit Real-time Event
                ; (emitter as any).emit(new OrderStatusUpdated({
                    orderId: order.id,
                    status: order.status,
                    clientId: order.clientId
                }))

            return order
        } catch (error) {
            await trx.rollback()
            logger.error({ err: error }, 'Mission status update failed')
            throw error
        }
    }
}
