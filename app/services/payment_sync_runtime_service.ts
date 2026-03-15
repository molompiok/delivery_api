import logger from '@adonisjs/core/services/logger'
import RedisService from '#services/redis_service'
import orderPaymentService from '#services/order_payment_service'
import walletBridge from '#services/wallet_bridge_service'

class PaymentSyncRuntimeService {
  private intervalHandle: NodeJS.Timeout | null = null
  private started = false
  private running = false

  private get enabled(): boolean {
    return String(process.env.PAYMENT_SYNC_RUNTIME_ENABLED || 'true').toLowerCase() !== 'false'
  }

  private get pollIntervalMs(): number {
    const raw = Number(process.env.PAYMENT_SYNC_RUNTIME_INTERVAL_MS || 15_000)
    if (!Number.isFinite(raw) || raw < 5_000) return 15_000
    return Math.floor(raw)
  }

  private get batchSize(): number {
    const raw = Number(process.env.PAYMENT_SYNC_RUNTIME_BATCH_SIZE || 50)
    if (!Number.isFinite(raw) || raw < 1) return 50
    return Math.floor(raw)
  }

  public async start() {
    if (!this.enabled) {
      logger.info('[PaymentSyncRuntime] Disabled by configuration')
      return
    }

    if (this.started) {
      logger.debug('[PaymentSyncRuntime] Already started')
      return
    }

    this.started = true
    logger.info(
      { pollIntervalMs: this.pollIntervalMs, batchSize: this.batchSize },
      '[PaymentSyncRuntime] Starting runtime sync loop'
    )

    await this.tick()
    this.intervalHandle = setInterval(() => {
      void this.tick()
    }, this.pollIntervalMs)
  }

  public async stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    this.started = false
    logger.info('[PaymentSyncRuntime] Stopped runtime sync loop')
  }

  private async tick() {
    if (this.running) {
      logger.warn('[PaymentSyncRuntime] Previous tick still running, skipping this cycle')
      return
    }

    this.running = true
    try {
      const lockTtlSeconds = Math.max(30, Math.ceil((this.pollIntervalMs * 2) / 1000))
      const lockAcquired = await RedisService.acquireLock('payment_sync_runtime_tick', lockTtlSeconds)

      if (!lockAcquired) {
        logger.debug('[PaymentSyncRuntime] Tick lock not acquired, another instance is syncing')
        return
      }

      const pendingIntents = await orderPaymentService.getPendingExternalIntents(this.batchSize)
      if (pendingIntents.length === 0) {
        logger.debug('[PaymentSyncRuntime] No pending intents to sync')
        return
      }

      logger.info({ count: pendingIntents.length }, '[PaymentSyncRuntime] Processing pending intents')

      for (const intent of pendingIntents) {
        if (!intent.externalId) continue

        try {
          const status = await walletBridge.checkPaymentStatus({
            externalId: intent.externalId,
            internalId: intent.id,
          })

          if (status === 'COMPLETED') {
            await orderPaymentService.syncIntentStatus(intent.id, 'COMPLETED')
            logger.info({ intentId: intent.id }, '[PaymentSyncRuntime] Intent synchronized')
          }
        } catch (error: any) {
          logger.error(
            { intentId: intent.id, externalId: intent.externalId, error: error?.message },
            '[PaymentSyncRuntime] Failed to synchronize intent'
          )
        }
      }
    } catch (error: any) {
      logger.error({ error: error?.message }, '[PaymentSyncRuntime] Tick failed')
    } finally {
      this.running = false
    }
  }
}

export default new PaymentSyncRuntimeService()
