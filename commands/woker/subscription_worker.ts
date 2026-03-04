import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { closeSubscriptionQueue, startSubscriptionWorker } from '#queues/subscription_queue'

export default class SubscriptionWorker extends BaseCommand {
  static commandName = 'subscription:worker'
  static description = 'Start BullMQ worker for subscription recurring jobs'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Starting subscription worker...')
    this.logger.info('Subscription worker is listening. Press Ctrl+C to stop.')
    startSubscriptionWorker()

    await new Promise((resolve) => {
      const shutdown = async () => {
        this.logger.info('Shutting down subscription worker...')
        await closeSubscriptionQueue()
        resolve(true)
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })

    this.logger.success('Subscription worker stopped gracefully')
  }
}
