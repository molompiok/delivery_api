import app from '@adonisjs/core/services/app'
import paymentSyncRuntimeService from '#services/payment_sync_runtime_service'

app.ready(async () => {
  try {
    await paymentSyncRuntimeService.start()
  } catch (error) {
    console.error('[PaymentSyncRuntime] Failed to start runtime worker', error)
  }
})

app.terminating(async () => {
  await paymentSyncRuntimeService.stop()
})
