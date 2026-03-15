import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { DateTime } from 'luxon'
import { shiftQueue } from '#queues/shift_queue'
import { locationQueue } from '#queues/location_queue'
import { subscriptionQueue } from '#queues/subscription_queue'
import { paymentQueue } from '#queues/payment_queue'

export default class AppScheduler extends BaseCommand {
    static commandName = 'app:scheduler'
    static description = 'Trigger periodic tasks (Shifts, Payments, Invoices)'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('⏲️ Running App Scheduler...')
        const now = DateTime.now()

        try {
            // 1. Shift Check (Every minute)
            const shiftJobId = `shift-check-${now.toFormat('yyyy-LL-dd-HH-mm')}`
            await shiftQueue.add('check-shifts', { timestamp: now.toISO() }, { jobId: shiftJobId })
            this.logger.debug('Shift check enqueued')

            // 2. Location Flush (Every minute via scheduler, although location_queue has its own repeat)
            // We keep it here as a safety or if Cron is the only driver
            await locationQueue.add('flush-locations', { forced: true })
            this.logger.debug('Location flush triggered')

            // 3. Payment Sync (Every 10 minutes - Fallback for Webhooks)
            if (now.minute % 10 === 0) {
                const paymentJobId = `payment-sync-${now.toFormat('yyyy-LL-dd-HH-mm')}`
                await paymentQueue.add('sync-payments', {}, { jobId: paymentJobId })
                this.logger.info('Payment sync enqueued (fallback)')
            }

            // 4. Subscription Invoices (Once a day at 01:00)
            if (now.hour === 1 && now.minute === 0) {
                const month = now.minus({ months: 1 }).toFormat('yyyy-LL')
                await subscriptionQueue.add(
                    'generate-monthly-invoices',
                    { month },
                    { jobId: `sub-inv-${month}` }
                )

                await subscriptionQueue.add(
                    'validate-invoices',
                    { at: now.toISO() },
                    { jobId: `sub-val-${now.toFormat('yyyy-LL-dd')}` }
                )
                this.logger.info('Subscription cleaning/invoice jobs enqueued')
            }

            this.logger.success('Scheduler finished successfully.')
        } catch (error) {
            this.logger.error('Scheduler failed: ' + error.message)
            this.exitCode = 1
        } finally {
            // We don't close queues here because common practice in Adonis is that the process exits
            // But some drivers might need explicit close if they use pooling.
            // For a Cron task, it's fine.
        }
    }
}
