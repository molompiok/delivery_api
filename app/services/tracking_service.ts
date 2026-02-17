import redis from '@adonisjs/redis/services/main'
import RedisService from '#services/redis_service'
import { DateTime } from 'luxon'
import DriverLocationHistory from '#models/driver_location_history'

/**
 * TrackingService
 * 
 * Gère la réception des coordonnées GPS des chauffeurs.
 * Optimisé pour la haute fréquence :
 * 1. Update Redis (Snapshot + GeoSet) pour le dispatching immédiat.
 * 2. Buffering dans Redis pour l'historique.
 * 3. Flush périodique ou par nombre de pings vers SQL (Audit/Log).
 */
export class TrackingService {
    private readonly BUFFER_KEY = 'sublymus:location:buffer'
    private readonly MAX_BATCH_SIZE = 10 // Réduit pour plus de réactivité (historique SQL plus frais)
    private readonly FLUSH_INTERVAL_MS = 30000 // 30 secondes
    private lastFlushTime = Date.now()

    /**
     * Reçoit une position GPS d'un mobile
     */
    async track(userId: string, lat: number, lng: number, heading?: number): Promise<void> {
        const timestamp = DateTime.now().toISO()

        // 1. Mise à jour Redis (Source de vérité immédiate pour le dispatch)
        await RedisService.updateDriverLocation(userId, lat, lng)

        // 2. Buffering pour l'historique SQL global
        const pingData = JSON.stringify({ userId, lat, lng, heading, timestamp })
        const batchSize = await redis.rpush(this.BUFFER_KEY, pingData)

        // 3. Suivi spécifique aux missions en cours via RedisService
        const state = await RedisService.getDriverState(userId)
        if (state && state.current_orders && state.current_orders.length > 0) {
            for (const orderId of state.current_orders) {
                await RedisService.pushOrderTracePoint(orderId, lng, lat, timestamp!)
            }
        }

        // 4. Si on atteint le seuil global ou le délai, on déclenche le flush via BullMQ
        const timeSinceLastFlush = Date.now() - this.lastFlushTime
        if (batchSize >= this.MAX_BATCH_SIZE || timeSinceLastFlush >= this.FLUSH_INTERVAL_MS) {
            await this.enqueueFlush()
            this.lastFlushTime = Date.now()
        }
    }

    /**
     * Envoie le batch à BullMQ pour insertion SQL
     */
    private async enqueueFlush(): Promise<void> {
        // Pour éviter que plusieurs pings ne déclenchent le flush simultanément
        if (await RedisService.acquireLock('location_flush', 2)) {
            try {
                const { locationQueue } = await import('#queues/location_queue')
                await locationQueue.add('flush-locations', { timestamp: new Date().toISOString() })
            } finally {
                // On ne release pas tout de suite pour laisser le temps au worker de vider la liste
            }
        }
    }

    /**
     * Utilisé par le worker pour vider le buffer et sauvegarder en SQL
     */
    async flushBufferToSQL(): Promise<number> {
        // On récupère tout le buffer pour vider au maximum
        const rawPings = await redis.lrange(this.BUFFER_KEY, 0, -1)
        if (!rawPings || rawPings.length === 0) return 0

        const pings = rawPings.map((p: string) => JSON.parse(p))

        // 1. Bulk Insert into DriverLocationHistory table
        const historyData = pings.map(p => ({
            userId: p.userId,
            lat: p.lat,
            lng: p.lng,
            heading: p.heading || null,
            timestamp: DateTime.fromISO(p.timestamp)
        }))

        await DriverLocationHistory.createMany(historyData)

        // 2. Mettre à jour la dernière position dans DriverSetting
        await this.syncLastPositions(pings)

        // 3. Supprimer les éléments traités de la liste Redis
        await redis.ltrim(this.BUFFER_KEY, rawPings.length, -1)

        return rawPings.length
    }

    private async syncLastPositions(pings: any[]): Promise<void> {
        const DriverSetting = (await import('#models/driver_setting')).default

        // On prend la dernière position connue pour chaque driver unique dans le batch
        const latestPerDriver = new Map<string, any>()
        for (const ping of pings) {
            latestPerDriver.set(ping.userId, ping)
        }

        for (const [userId, ping] of latestPerDriver) {
            await DriverSetting.query()
                .where('userId', userId)
                .update({
                    currentLat: ping.lat,
                    currentLng: ping.lng,
                    updatedAt: DateTime.now().toSQL()
                })
        }
    }
}

export default new TrackingService()
