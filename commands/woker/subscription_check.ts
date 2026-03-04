import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { DateTime } from 'luxon'
import { subscriptionQueue } from '#queues/subscription_queue'

export default class SubscriptionCheck extends BaseCommand {
  static commandName = 'subscription:check'
  static description = 'Enqueue monthly subscription invoice generation and overdue validation jobs'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Starting subscription recurring checks...')

    try {
      const parsedMonth = String((this.parsed as any)?.flags?.month || '').trim()
      const month = parsedMonth || DateTime.utc().startOf('month').minus({ months: 1 }).toFormat('yyyy-LL')
      const now = DateTime.utc()

      await subscriptionQueue.add(
        'generate-monthly-invoices',
        { month },
        {
          jobId: `subscription-invoices-${month}`,
          priority: 1,
        }
      )

      await subscriptionQueue.add(
        'validate-invoices',
        { at: now.toISO() },
        {
          jobId: `subscription-overdue-${now.toFormat('yyyy-LL-dd-HH')}`,
          priority: 2,
        }
      )

      this.logger.success(`Subscription jobs enqueued (month=${month})`)
    } catch (error) {
      this.logger.error('Failed to enqueue subscription jobs')
      this.logger.error(String(error))
      this.exitCode = 1
    } finally {
      await subscriptionQueue.close()
      const code = this.exitCode ?? 0
      setTimeout(() => process.exit(code), 0)
    }
  }
}
