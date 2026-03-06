import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import orderPaymentService from '#services/order_payment_service'
import walletBridge from '#services/wallet_bridge_service'

export default class PaymentSyncWorker extends BaseCommand {
  static commandName = 'payment:sync-worker'
  static description = 'Synchronize pending PaymentIntents with Wave API'

  static options: CommandOptions = {
    startApp: true
  }

  async run() {
    this.logger.info('Starting Payment Sync Worker...')

    try {
      const pendingIntents = await orderPaymentService.getPendingExternalIntents(50)
      this.logger.info(`Found ${pendingIntents.length} pending intents to check.`)

      for (const intent of pendingIntents) {
        if (!intent.externalId) continue

        this.logger.debug(`Checking status for Intent ${intent.id} (External: ${intent.externalId})...`)

        const status = await walletBridge.checkPaymentStatus({
          externalId: intent.externalId,
          internalId: intent.id
        })

        if (status === 'COMPLETED') {
          this.logger.success(`Payment confirmed for Intent ${intent.id}. Synchronizing...`)
          await orderPaymentService.syncIntentStatus(intent.id, 'COMPLETED')
        } else {
          this.logger.debug(`Intent ${intent.id} still pending or not found in recent ledger.`)
        }
      }

      this.logger.info('Payment Sync Worker finished.')
    } catch (error) {
      this.logger.error(`Worker failed: ${error.message}`)
    }
  }
}