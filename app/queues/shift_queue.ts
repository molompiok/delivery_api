import { Queue, Worker, Job } from 'bullmq'
import ShiftService from '#services/shift_service'

/**
 * Configuration Redis pour BullMQ
 */
const redisConnection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
}

/**
 * Queue pour les vérifications de shifts
 */
export const shiftQueue = new Queue('shift-checks', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000,
        },
        removeOnComplete: {
            age: 3600, // Garder 1 heure
            count: 100,
        },
        removeOnFail: {
            age: 86400, // Garder 24 heures
        },
    },
})

/**
 * Worker qui traite les vérifications de shifts
 */
export const shiftWorker = new Worker(
    'shift-checks',
    async (job: Job) => {
        console.log(`[SHIFT WORKER] Processing job ${job.id}`)

        try {
            await ShiftService.checkAndSwitchAllDrivers()
            return { success: true, timestamp: new Date().toISOString() }
        } catch (error: any) {
            console.error('[SHIFT WORKER] Error:', error)
            throw error
        }
    },
    {
        connection: redisConnection,
        concurrency: 1, // Traiter un seul job à la fois pour éviter les conflits
    }
)

/**
 * Event handlers pour monitoring
 */
shiftWorker.on('completed', (job) => {
    console.log(`[SHIFT WORKER] Job ${job.id} completed successfully`)
})

shiftWorker.on('failed', (job, error) => {
    console.error(`[SHIFT WORKER] Job ${job?.id} failed:`, error)
})

shiftWorker.on('error', (error) => {
    console.error('[SHIFT WORKER] Worker error:', error)
})

/**
 * Ajoute un job de vérification dans la queue
 * 
 * IDEMPOTENT : Si un job du même type existe déjà, il ne sera pas dupliqué
 */
export async function enqueueShiftCheck(): Promise<void> {
    const jobId = `shift-check-${Date.now()}`

    await shiftQueue.add(
        'check-shifts',
        { timestamp: new Date().toISOString() },
        {
            jobId, // ID unique pour éviter les doublons
            priority: 1,
        }
    )

    console.log(`[SHIFT QUEUE] Job ${jobId} enqueued`)
}

/**
 * Graceful shutdown
 */
export async function closeShiftQueue(): Promise<void> {
    await shiftQueue.close()
    await shiftWorker.close()
}
