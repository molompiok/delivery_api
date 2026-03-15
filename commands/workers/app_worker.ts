import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { startShiftWorker, closeShiftQueue } from '#queues/shift_queue'
import { startLocationWorker, closeLocationQueue } from '#queues/location_queue'
import { startSubscriptionWorker, closeSubscriptionQueue } from '#queues/subscription_queue'
import { startPaymentWorker, closePaymentQueue } from '#queues/payment_queue'

export default class AppWorker extends BaseCommand {
    static commandName = 'app:worker'
    static description = 'Start all BullMQ workers (Shifts, Location, Subscriptions, Payments)'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('🚀 Starting Consolidated App Workers...')

        // Start all workers
        startShiftWorker()
        startLocationWorker()
        startSubscriptionWorker()
        startPaymentWorker()

        this.logger.info('✅ All workers are now listening. Press Ctrl+C to stop.')

        await new Promise((resolve) => {
            const shutdown = async () => {
                this.logger.info('\n🛑 Shutting down workers...')

                try {
                    await Promise.all([
                        closeShiftQueue(),
                        closeLocationQueue(),
                        closeSubscriptionQueue(),
                        closePaymentQueue()
                    ])
                    this.logger.success('Graceful shutdown completed.')
                } catch (error) {
                    this.logger.error('Error during shutdown: ' + error.message)
                }

                resolve(true)
            }

            process.on('SIGINT', shutdown)
            process.on('SIGTERM', shutdown)
        })
    }
}
