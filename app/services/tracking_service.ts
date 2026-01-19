import Redis from '@adonisjs/lucid/services/db'
import RedisService from '#services/redis_service'
import { DateTime } from 'luxon'

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
    private readonly MAX_BATCH_SIZE = 50

    /**
     * Reçoit une position GPS d'un mobile
     */
    async track(userId: string, lat: number, lng: number, heading?: number): Promise<void> {
        const timestamp = DateTime.now().toISO()

        // 1. Mise à jour Redis (Source de vérité immédiate pour le dispatch)
        await RedisService.updateDriverLocation(userId, lat, lng)

        // 2. Buffering pour l'historique SQL
        const pingData = JSON.stringify({ userId, lat, lng, heading, timestamp })
        const batchSize = await (Redis.connection() as any).rpush(this.BUFFER_KEY, pingData)

        // 3. Si on atteint le seuil, on déclenche le flush via BullMQ
        if (batchSize >= this.MAX_BATCH_SIZE) {
            await this.enqueueFlush()
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
                // ou on laisse le lock expirer
            }
        }
    }

    /**
     * Utilisé par le worker pour vider le buffer et sauvegarder en SQL
     */
    async flushBufferToSQL(): Promise<number> {
        const rawPings = await (Redis.connection() as any).lrange(this.BUFFER_KEY, 0, this.MAX_BATCH_SIZE - 1)
        if (!rawPings || rawPings.length === 0) return 0

        const pings = rawPings.map((p: string) => JSON.parse(p))

        // TODO: Bulk Insert into DriverLocationHistory table
        // await DriverLocationHistory.createMany(pings)

        // Mettre à jour la dernière position dans DriverSetting pour chaque driver du batch
        await this.syncLastPositions(pings)

        // Supprimer les éléments traités de la liste Redis
        await (Redis.connection() as any).ltrim(this.BUFFER_KEY, rawPings.length, -1)

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
