import { Queue, Worker, Job } from 'bullmq'
import orderPaymentService from '#services/order_payment_service'
import walletBridge from '#services/wallet_bridge_service'

const redisConnection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
}

export const paymentQueue = new Queue('payment-sync', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: {
            age: 3600 * 24,
        },
    },
})

let paymentWorker: Worker | null = null

export function startPaymentWorker(): Worker {
    if (paymentWorker) return paymentWorker

    paymentWorker = new Worker(
        'payment-sync',
        async (job: Job) => {
            console.log(`[PAYMENT WORKER] Checking pending status... ${job.id}`)
            try {
                const pendingIntents = await orderPaymentService.getPendingExternalIntents()
                console.log(`[PAYMENT WORKER] Found ${pendingIntents.length} pending intents to check.`)

                for (const intent of pendingIntents) {
                    if (!intent.externalId) continue

                    const status = await walletBridge.checkPaymentStatus({
                        externalId: intent.externalId,
                        internalId: intent.id
                    })

                    if (status === 'COMPLETED') {
                        console.log(`[PAYMENT WORKER] Payment confirmed for Intent ${intent.id}. Synchronizing...`)
                        await orderPaymentService.syncIntentStatus(intent.id, 'COMPLETED')
                    }
                }

                // Nettoyage des vieux intents abandonnés (> 48h)
                const cleanedCount = await orderPaymentService.cleanupAbandonedIntents()

                return {
                    checked: pendingIntents.length,
                    cleaned: cleanedCount
                }
            } catch (error) {
                console.error('[PAYMENT WORKER] Sync error:', error)
                throw error
            }
        },
        {
            connection: redisConnection,
            concurrency: 1,
        }
    )

    return paymentWorker
}

export async function closePaymentQueue(): Promise<void> {
    await paymentQueue.close()
    if (paymentWorker) {
        await paymentWorker.close()
        paymentWorker = null
    }
}
