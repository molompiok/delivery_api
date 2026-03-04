import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import Order from '#models/order'
import { DateTime } from 'luxon'
import DispatchService from '#services/dispatch_service'
import { inject } from '@adonisjs/core'
import RedisService from '#services/redis_service'
import logger from '@adonisjs/core/services/logger'

export default class AssignmentWorker extends BaseCommand {
  static commandName = 'assignment:worker'
  static description = 'Handles mission timeout and sequential dispatching'

  static options: CommandOptions = {
    startApp: true,
  }

  private isRunning = true

  @inject()
  async run(dispatchService: DispatchService) {
    logger.info('🚀 Assignment Worker started')

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      this.isRunning = false
    })

    while (this.isRunning) {
      try {
        await this.checkExpiredOffers(dispatchService)
      } catch (error) {
        logger.error({ err: error }, 'Error in Assignment Worker loop')
      }

      // Wait 10 seconds between scans
      await new Promise((resolve) => setTimeout(resolve, 10000))
    }

    logger.info('👋 Assignment Worker stopped')
  }

  /**
   * Scans for orders where the offering has expired.
   */
  private async checkExpiredOffers(dispatchService: DispatchService) {
    const now = DateTime.now()

    // Find orders with active offer that has expired
    const expiredOrders = await Order.query()
      .where('status', 'PENDING')
      .whereNotNull('offeredDriverId')
      .where('offer_expires_at', '<', now.toSQL())

    if (expiredOrders.length > 0) {
      logger.info({ count: expiredOrders.length.toString }, 'Found expired offers')
    }

    for (const order of expiredOrders) {
      const driverId = order.offeredDriverId!

      logger.info({ orderId: order.id, driverId }, 'Processing expired offer')

      // 1. Libérer le chauffeur dans Redis (OFFERING -> ONLINE)
      // Note: Le driver était en OFFERING, pas encore assigné, donc pas besoin de toucher à current_orders
      await RedisService.updateDriverState(driverId, { status: 'ONLINE' })

      // 2. Marquer le chauffeur comme ayant "rejeté" (techniquement expiré) pour cet ordre
      // pour éviter de lui proposer à nouveau immédiatement
      await dispatchService.registerRejection(order.id, driverId)

      // 3. Nettoyer l'offre sur l'ordre
      order.offeredDriverId = null
      order.offerExpiresAt = null
      await order.save()

      // 4. Déclencher le dispatch suivant
      await dispatchService.dispatch(order)
    }
  }
}