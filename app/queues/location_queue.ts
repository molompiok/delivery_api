import { Queue, Worker, Job } from 'bullmq'
import TrackingService from '#services/tracking_service'

/**
 * Configuration Redis pour BullMQ
 */
const redisConnection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
}

/**
 * Queue pour le flush des positions GPS
 */
export const locationQueue = new Queue('location-flush', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 1, // Pas besoin de retry infini pour l'historique
        removeOnComplete: true,
        removeOnFail: {
            age: 3600 * 24, // Garder 24h
        },
    },
})

/**
 * Worker qui vide le buffer Redis vers SQL
 */
export const locationWorker = new Worker(
    'location-flush',
    async (job: Job) => {
        console.log(`[LOCATION WORKER] Flushing batch... ${job.id}`)
        try {
            const count = await TrackingService.flushBufferToSQL()
            return { flushed: count }
        } catch (error) {
            console.error('[LOCATION WORKER] Flush error:', error)
            throw error
        }
    },
    {
        connection: redisConnection,
        concurrency: 1, // Un seul flush à la fois
    }
)

/**
 * Graceful shutdown
 */
export async function closeLocationQueue(): Promise<void> {
    await locationQueue.close()
    await locationWorker.close()
}
