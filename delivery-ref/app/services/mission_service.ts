import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import Order from '#models/order'
import Mission from '#models/mission'
import OrderStatusUpdated from '#events/order_status_updated'
import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import logger from '@adonisjs/core/services/logger'
import RedisService from '#services/redis_service'
import { inject } from '@adonisjs/core'
import DispatchService from '#services/dispatch_service'

@inject()
export default class MissionService {
    constructor(protected dispatchService: DispatchService) { }

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

            // Document Compliance Check (Lazy loading CompanyDriverSetting/DriverSetting is fine here)
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
            order.offerExpiresAt = null
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

            // Add order to driver's active missions in Redis
            await order.load('deliveryAddress')
            await RedisService.addOrderToDriver(driverId, orderId, {
                lat: order.deliveryAddress.lat,
                lng: order.deliveryAddress.lng
            })

            await trx.commit()

            // Emit Real-time Event
            emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
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
            // 1. Register rejection to avoid offering again
            await this.dispatchService.registerRejection(orderId, driverId)

            // 2. Clear offer
            order.offeredDriverId = null
            order.offerExpiresAt = null
            await order.save()

            // 3. Clear driver's current order from Redis
            // Note: En refus d'offre, le driver n'a pas encore officiellement cette commande
            // On s'assure simplement qu'il repasse ONLINE (géré via removeOrderFromDriver si besoin)
            const state = await RedisService.getDriverState(driverId)
            if (state && state.status === 'OFFERING') {
                await RedisService.updateDriverState(driverId, { status: 'ONLINE' })
            }

            // 4. Trigger next dispatch attempt immediately
            this.dispatchService.dispatch(order).catch(err => {
                logger.error({ err, orderId }, 'Dispatch failed after refusal')
            })
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

            // Validate transitions
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

            // Remove order from driver's active list in Redis if terminal state
            if (['DELIVERED', 'FAILED', 'CANCELLED'].includes(status)) {
                await RedisService.removeOrderFromDriver(driverId, orderId)
            }

            // Log the event
            logger.info({ orderId, status, driverId }, 'Mission status updated')

            await trx.commit()

            // Emit Real-time Event
            emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
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
