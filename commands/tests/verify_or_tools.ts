import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import Order from '#models/order'
import OrderDraftService from '#services/order/order_draft_service'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'

export default class VerifyOrTools extends BaseCommand {
  static commandName = 'verify:or-tools'
  static description = 'Verify OR-Tools integration and optionally save results'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.boolean({ description: 'Actually save the result to the database' })
  public save: boolean = false

  @inject()
  async run(orderDraftService: OrderDraftService) {
    this.logger.info('Starting OR-Tools verification...')

    try {
      // 1. Find a sample order (e.g., the last one created)
      const order = await Order.query()
        .preload('steps', (q) => q.preload('stops', (sq) => sq.preload('address').preload('actions')))
        .preload('vehicle')
        .preload('transitItems')
        .orderBy('createdAt', 'desc')
        .first()

      if (!order) {
        this.logger.error('No order found to test.')
        return
      }

      this.logger.info(`Testing optimization for Order: ${order.id} (${order.refId || 'no ref'})`)

      if (this.save) {
        this.logger.info('SAVE mode enabled. Will update database.')
        const trx = await db.transaction()
        try {
          await orderDraftService.calculateOrderStats(order, trx)
          await trx.commit()
          this.logger.success('Database updated successfully!')
        } catch (e) {
          await trx.rollback()
          this.logger.error(`Failed to save: ${e.message}`)
          return
        }
      } else {
        // Just print result
        const visitedIds = new Set<string>()
        this.logger.info('Calling OrToolsService (Dry Run)...')
        const result = await (orderDraftService as any).optimizeViaOrTools(order, { visitedIds })

        if (!result) {
          this.logger.error('Optimization failed (null result)')
          return
        }

        this.logger.info(`Status: ${result.status}`)
        if (result.status === 'success') {
          this.logger.success('Optimization successful!')
          this.logger.info(`Total Distance: ${result.totalDistance}m`)
          this.logger.info('Optimal Order:')
          for (const s of result.stopOrder) {
            this.logger.info(`- Stop ${s.stop_id} (execution_order: ${s.execution_order})`)
          }
        } else {
          this.logger.error(`Optimization failed: ${result.message}`)
        }
      }

    } catch (error) {
      this.logger.error(`Error during verification: ${error.message}`)
      console.error(error)
    }
  }
}
