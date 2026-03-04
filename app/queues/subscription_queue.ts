import { Queue, Worker, Job } from 'bullmq'
import subscriptionService from '#services/subscription_service'

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
}

export const subscriptionQueue = new Queue('subscription-checks', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600,
      count: 100,
    },
    removeOnFail: {
      age: 86400,
    },
  },
})

let subscriptionWorker: Worker | null = null

export function startSubscriptionWorker(): Worker {
  if (subscriptionWorker) return subscriptionWorker

  subscriptionWorker = new Worker(
    'subscription-checks',
    async (job: Job) => {
      console.log(`[SUBSCRIPTION WORKER] Processing job ${job.id} (${job.name})`)

      if (job.name === 'generate-monthly-invoices') {
        return subscriptionService.generateMonthlyInvoices({ month: job.data?.month })
      }

      if (job.name === 'validate-invoices') {
        return subscriptionService.markOverdueInvoices()
      }

      throw new Error(`Unknown subscription job: ${job.name}`)
    },
    {
      connection: redisConnection,
      concurrency: 1,
    }
  )

  subscriptionWorker.on('completed', (job) => {
    console.log(`[SUBSCRIPTION WORKER] Job ${job.id} completed`)
  })

  subscriptionWorker.on('failed', (job, error) => {
    console.error(`[SUBSCRIPTION WORKER] Job ${job?.id} failed:`, error)
  })

  subscriptionWorker.on('error', (error) => {
    console.error('[SUBSCRIPTION WORKER] Worker error:', error)
  })

  return subscriptionWorker
}

export async function closeSubscriptionQueue(): Promise<void> {
  if (subscriptionWorker) {
    await subscriptionWorker.close()
    subscriptionWorker = null
  }
  await subscriptionQueue.close()
}
