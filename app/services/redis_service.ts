import Redis from '@adonisjs/lucid/services/db'
import { WorkMode } from '#constants/work_mode'

/**
 * CondensedDriverState
 * 
 * Représente l'état minimal et critique d'un chauffeur pour le dispatching.
 * Stocké dans Redis pour une lecture ultra-rapide (< 2ms).
 */
export interface CondensedDriverState {
    id: string
    mode: WorkMode
    status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'PAUSE'
    last_lat?: number
    last_lng?: number
    active_company_id?: string
    active_zone_id?: string
    active_vehicle_id?: string
    current_order_id?: string
    updated_at: string
}

export class RedisService {
    private readonly PREFIX = 'sublymus:driver:'

    /**
     * Met à jour l'état condensé d'un chauffeur dans Redis
     */
    async updateDriverState(driverId: string, data: Partial<CondensedDriverState>): Promise<void> {
        const key = `${this.PREFIX}${driverId}:state`

        // 1. Récupérer l'état actuel
        const currentStateStr = await (Redis.connection() as any).get(key)
        let state: CondensedDriverState

        if (currentStateStr) {
            state = { ...JSON.parse(currentStateStr), ...data, updated_at: new Date().toISOString() }
        } else {
            // Initialisation si n'existe pas
            state = {
                id: driverId,
                mode: WorkMode.IDEP,
                status: 'OFFLINE',
                updated_at: new Date().toISOString(),
                ...data
            }
        }

        // 2. Sauvegarder dans Redis (sans expiration pour l'état critique)
        await (Redis.connection() as any).set(key, JSON.stringify(state))

        // 3. Nettoyage automatique du geo-index si OFFLINE ou PAUSE
        if (state.status === 'OFFLINE' || state.status === 'PAUSE') {
            await this.removeDriverFromGeoIndex(driverId)
        }

        console.log(`[REDIS] Updated state for driver ${driverId}`)
    }

    /**
     * Récupère l'état d'un driver depuis Redis
     */
    async getDriverState(driverId: string): Promise<CondensedDriverState | null> {
        const key = `${this.PREFIX}${driverId}:state`
        const data = await (Redis.connection() as any).get(key)
        return data ? JSON.parse(data) : null
    }

    /**
     * Met à jour uniquement la position (très fréquent)
     */
    async updateDriverLocation(driverId: string, lat: number, lng: number): Promise<void> {
        await this.updateDriverState(driverId, { last_lat: lat, last_lng: lng })

        // On peut aussi stocker dans un GeoSet Redis pour recherche par proximité
        const geoKey = 'sublymus:drivers:locations'
        await (Redis.connection() as any).geoadd(geoKey, lng, lat, driverId)
    }

    /**
     * Supprime un driver du geo-index (ex: quand il passe OFFLINE)
     */
    async removeDriverFromGeoIndex(driverId: string): Promise<void> {
        const geoKey = 'sublymus:drivers:locations'
        await (Redis.connection() as any).zrem(geoKey, driverId)
        console.log(`[REDIS] Removed driver ${driverId} from geo-index`)
    }

    /**
     * Acquire simple lock (pour éviter les race conditions)
     * TTL par défaut de 5 secondes pour éviter les blocages infinis
     */
    async acquireLock(resource: string, ttlSeconds: number = 5): Promise<boolean> {
        const lockKey = `sublymus:lock:${resource}`
        const result = await (Redis.connection() as any).set(lockKey, 'locked', 'EX', ttlSeconds, 'NX')
        return result === 'OK'
    }

    /**
     * Release lock
     */
    async releaseLock(resource: string): Promise<void> {
        const lockKey = `sublymus:lock:${resource}`
        await (Redis.connection() as any).del(lockKey)
    }

    /**
     * Synchronise tous les drivers actifs de SQL vers Redis (WarmUp)
     */
    async syncAllDriversToRedis(): Promise<void> {
        const DriverSetting = (await import('#models/driver_setting')).default

        // On récupère tout le nécessaire pour le snapshot
        const drivers = await DriverSetting.query()
            .preload('user')
        // .preload('activeZone') // On chargera les IDs directement
        // .preload('activeVehicle')

        console.log(`[REDIS] Warm-up: Syncing ${drivers.length} drivers...`)

        for (const driver of drivers) {
            await this.syncDriverToRedis(driver.userId)
        }

        console.log('[REDIS] Warm-up completed.')
    }

    /**
     * Synchronise un driver spécifique de SQL vers Redis
     */
    async syncDriverToRedis(userId: string): Promise<void> {
        const DriverSetting = (await import('#models/driver_setting')).default
        const CompanyDriverSetting = (await import('#models/company_driver_setting')).default

        const driver = await DriverSetting.query()
            .where('userId', userId)
            .first()

        if (!driver) return

        // Récupérer la relation ETP active si elle existe pour la zone/véhicule ETP
        const etpRelation = await CompanyDriverSetting.query()
            .where('driverId', userId)
            .where('status', 'ACCEPTED')
            .first()

        // Déterminer les IDs de contexte selon le mode actuel
        const isETP = driver.currentMode.includes('ETP')

        await this.updateDriverState(userId, {
            mode: driver.currentMode,
            status: driver.status,
            last_lat: driver.currentLat || undefined,
            last_lng: driver.currentLng || undefined,
            active_company_id: etpRelation?.companyId || undefined,
            active_zone_id: isETP ? (etpRelation?.activeZoneId || undefined) : (driver.activeZoneId || undefined),
            active_vehicle_id: isETP ? (etpRelation?.activeVehicleId || undefined) : (driver.activeVehicleId || undefined),
            updated_at: new Date().toISOString()
        })
    }
}

export default new RedisService()
