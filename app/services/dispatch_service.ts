import Order from '#models/order'
import User from '#models/user'
import MissionService from '#services/mission_service'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'
import emitter from '@adonisjs/core/services/emitter'
import MissionOffered from '#events/mission_offered'

@inject()
export default class DispatchService {
    constructor(protected missionService: MissionService) { }

    /**
     * Main entry point to dispatch an order based on its assignment mode.
     */
    async dispatch(order: Order) {
        logger.info({ orderId: order.id, mode: order.assignmentMode, refId: order.refId }, 'Starting dispatch process')

        switch (order.assignmentMode) {
            case 'TARGET':
                await this.handleTargetDispatch(order)
                break
            case 'INTERNAL':
                await this.handleInternalDispatch(order)
                break
            case 'GLOBAL':
            default:
                await this.handleGlobalDispatch(order)
                break
        }
    }

    /**
     * Dispatch to a specific target (Driver or Company) via Ref-ID.
     */
    private async handleTargetDispatch(order: Order) {
        if (!order.refId) {
            logger.warn({ orderId: order.id }, 'Target dispatch failed: No refId provided. Falling back to Global.')
            return this.handleGlobalDispatch(order)
        }

        // Try finding a driver first
        const driver = await User.find(order.refId)
        if (driver && driver.isDriver && driver.isActive) {
            logger.info({ orderId: order.id, driverId: driver.id }, 'Target dispatch: Found specific driver')
            return this.offerToDriver(order, driver)
        }

        // Try finding a company (Logic to assign to company pool would go here)
        // For now, if refId is a company, we might want to internal dispatch within that company?
        // Let's assume for this phase refId targets a driver directly.

        logger.warn({ orderId: order.id, refId: order.refId }, 'Target dispatch failed: Target not found or invalid. Falling back to Global.')
        return this.handleGlobalDispatch(order)
    }

    /**
     * Dispatch to the client's company fleet.
     */
    private async handleInternalDispatch(order: Order) {
        // Load client's company
        await order.load('client')
        const companyId = order.client.companyId

        if (!companyId) {
            logger.warn({ orderId: order.id }, 'Internal dispatch failed: Client has no company. Falling back to Global.')
            return this.handleGlobalDispatch(order)
        }

        // Find best available driver in the company
        const driver = await User.query()
            .where('companyId', companyId)
            .where('isDriver', true)
            .where('isActive', true)
            .first() // Simplified "best" logic: just the first one found

        if (driver) {
            logger.info({ orderId: order.id, companyId, driverId: driver.id }, 'Internal dispatch: Found company driver')
            return this.offerToDriver(order, driver)
        }

        logger.warn({ orderId: order.id, companyId }, 'Internal dispatch failed: No drivers available in company.')
        // Fallback? Or stick to PENDING? Let's leave PENDING for now.
    }

    /**
     * Dispatch to the global pool (Geo-search).
     */
    private async handleGlobalDispatch(order: Order) {
        // Simplified Global Logic: Find ANY active driver not in a mission
        // In a real app, use GeoService to find nearest.

        // We need to avoid drivers who have already rejected this order (if we tracked rejections)

        const driver = await User.query()
            .where('isDriver', true)
            .where('isActive', true)
            .whereNull('companyId') // Global pool usually means freelancers? Or anyone? Let's say freelancers for now.
            .first()

        if (driver) {
            logger.info({ orderId: order.id, driverId: driver.id }, 'Global dispatch: Found freelancer')
            return this.offerToDriver(order, driver)
        }

        logger.info({ orderId: order.id }, 'Global dispatch: No drivers found.')
    }

    /**
     * Helper to execute the offer logic via MissionService (or directly here if simple)
     */
    private async offerToDriver(order: Order, driver: User) {
        // We update the order to OFFERED state (if we had one) or just set offeredDriverId
        order.offeredDriverId = driver.id
        order.offerExpiresAt = DateTime.now().plus({ minutes: 3 }) // 3 min to accept
        await order.save()

        // Notify Driver via Socket
        // We instantiate the event class as per Adonis 6 standard for typed events
        // This enforces payload type safety at construction time.
        // Even if we have to cast emitter to any (if events aren't globally registered),
        // we are at least sending a strictly typed object.
        await (emitter as any).emit(new MissionOffered({
            orderId: order.id,
            driverId: driver.id,
            expiresAt: order.offerExpiresAt?.toISO()!
        }))
    }
}
