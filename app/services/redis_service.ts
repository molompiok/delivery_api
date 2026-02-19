import redis from '@adonisjs/redis/services/main'
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
    status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'PAUSE' | 'OFFERING'
    last_lat?: number
    last_lng?: number
    heading?: number
    active_company_id?: string
    active_zone_id?: string
    active_vehicle_id?: string

    // Chaining Support
    current_orders: string[]  // Liste des ordres en cours (remplace current_order_id)
    allow_chaining: boolean   // Autoriser le chaînage
    next_destination?: { lat: number, lng: number }  // Prochain point de livraison prévu

    updated_at: string
}

/**
 * TODO [CHAINING EVOLUTION]:
 * Quand les critères de sélection seront plus avancés, ajouter ici:
 * - remaining_capacity_kg?: number   // Poids restant disponible dans le véhicule
 * - remaining_volume_m3?: number     // Volume restant disponible
 * - product_categories?: string[]    // Catégories de produits actuellement transportés (pour compatibilité)
 * 
 * Ces champs permettront de filtrer les livreurs éligibles au chaînage
 * en fonction de la capacité réelle et de la compatibilité des produits.
 * À ce moment, maxConcurrentOrders pourra devenir configurable par les ETP/IDEP.
 */

// Constante globale (modifiable uniquement par Admin pour l'instant)
export const MAX_CONCURRENT_ORDERS = 2

export class RedisService {
    private readonly PREFIX = 'sublymus:driver:'

    /**
     * Met à jour l'état condensé d'un chauffeur dans Redis
     */
    async updateDriverState(driverId: string, data: Partial<CondensedDriverState>): Promise<void> {
        const key = `${this.PREFIX}${driverId}:state`

        // 1. Récupérer l'état actuel
        const currentStateStr = await redis.get(key)
        let state: CondensedDriverState

        if (currentStateStr) {
            state = { ...JSON.parse(currentStateStr), ...data, updated_at: new Date().toISOString() }
        } else {
            // Initialisation si n'existe pas
            state = {
                id: driverId,
                mode: WorkMode.IDEP,
                status: 'OFFLINE',
                current_orders: [],
                allow_chaining: true,
                updated_at: new Date().toISOString(),
                ...data
            }
        }

        // 2. Sauvegarder dans Redis
        await redis.set(key, JSON.stringify(state))

        // 3. Nettoyage automatique du geo-index si incapacité de recevoir
        if (state.status === 'OFFLINE' || state.status === 'PAUSE' || state.status === 'BUSY' || state.status === 'OFFERING') {
            await this.removeDriverFromGeoIndex(driverId)
        }

        // console.log(`[REDIS] Updated state for driver ${driverId}`)
    }

    /**
     * Récupère l'état d'un driver depuis Redis
     */
    async getDriverState(driverId: string): Promise<CondensedDriverState | null> {
        const key = `${this.PREFIX}${driverId}:state`
        const data = await redis.get(key)
        return data ? JSON.parse(data) : null
    }

    /**
     * Met à jour uniquement la position (très fréquent)
     */
    async updateDriverLocation(driverId: string, lat: number, lng: number, heading?: number): Promise<void> {
        await this.updateDriverState(driverId, { last_lat: lat, last_lng: lng, heading })

        // On peut aussi stocker dans un GeoSet Redis pour recherche par proximité
        const geoKey = 'sublymus:drivers:locations'
        await redis.geoadd(geoKey, lng, lat, driverId)
    }

    /**
     * Pousse un point de trace pour une commande spécifique
     */
    async pushOrderTracePoint(orderId: string, lng: number, lat: number, ts: string): Promise<void> {
        const key = `order:trace:buffer:${orderId}`
        const point = JSON.stringify([lng, lat, ts])
        await redis.lpush(key, point)
        // TTL de 24h pour le buffer au cas où une commande n'est jamais terminée
        await redis.expire(key, 86400)
    }

    /**
     * Récupère la trace buffetisée d'une commande
     */
    async getOrderTrace(orderId: string): Promise<[number, number, string][]> {
        const key = `order:trace:buffer:${orderId}`
        const rawPoints = await redis.lrange(key, 0, -1)
        // Vient dans l'ordre inverse (LPUSH), donc on reverse
        return rawPoints.map(p => JSON.parse(p)).reverse()
    }

    /**
     * Lit le buffer de trace d'une commande sans le vider (Peek)
     */
    async peekOrderTrace(orderId: string): Promise<string[]> {
        const key = `order:trace:buffer:${orderId}`
        const points = await redis.lrange(key, 0, -1)
        return points.reverse()
    }

    /**
     * Vide explicitement le buffer de trace (à appeler après le commit DB)
     */
    async clearOrderTraceAfterFlush(orderId: string): Promise<void> {
        const key = `order:trace:buffer:${orderId}`
        await redis.del(key)
    }

    /**
     * Legacy method compatible (mais moins sûre)
     */
    async clearOrderTrace(orderId: string): Promise<string[]> {
        const points = await this.peekOrderTrace(orderId)
        await this.clearOrderTraceAfterFlush(orderId)
        return points
    }

    /**
     * Cache le tracé de navigation immédiat (nav_trace)
     */
    async setOrderNavTrace(orderId: string, trace: any): Promise<void> {
        const key = `order:route:nav_trace:${orderId}`
        await redis.set(key, JSON.stringify(trace), 'EX', 300) // TTL 5 min
    }

    /**
     * Récupère le tracé de navigation immédiat
     */
    async getOrderNavTrace(orderId: string): Promise<any | null> {
        const key = `order:route:nav_trace:${orderId}`
        const cached = await redis.get(key)
        return cached ? JSON.parse(cached) : null
    }

    /**
     * Invalide le tracé de navigation immédiat
     */
    async clearOrderNavTrace(orderId: string): Promise<void> {
        const key = `order:route:nav_trace:${orderId}`
        await redis.del(key)
    }

    /**
     * Supprime un driver du geo-index (ex: quand il passe OFFLINE)
     */
    async removeDriverFromGeoIndex(driverId: string): Promise<void> {
        const geoKey = 'sublymus:drivers:locations'
        await redis.zrem(geoKey, driverId)
        // console.log(`[REDIS] Removed driver ${driverId} from geo-index`)
    }

    /**
     * Recherche des drivers à proximité
     * @returns Liste des driverIds avec leur distance
     */
    async findDriversNearby(lng: number, lat: number, radiusKm: number, limit: number = 50): Promise<{ id: string, distance: number }[]> {
        const geoKey = 'sublymus:drivers:locations'
        // GEORADIUS is deprecated in some redis versions, using GEOSEARCH
        try {
            const results = await redis.geosearch(geoKey, 'FROMLONLAT', lng, lat, 'BYRADIUS', radiusKm, 'km', 'ASC', 'WITHDIST', 'COUNT', limit)
            return results.map((r: any) => ({
                id: r[0],
                distance: parseFloat(r[1])
            }))
        } catch (err) {
            console.error('[REDIS] geosearch failed, trying fallback georadius', err)
            // Fallback for older redis
            const results = await (redis as any).georadius(geoKey, lng, lat, radiusKm, 'km', 'WITHDIST', 'ASC', 'COUNT', limit)
            return results.map((r: any) => ({
                id: r[0],
                distance: parseFloat(r[1])
            }))
        }
    }

    /**
     * Ajoute un ordre à la liste des ordres en cours d'un driver.
     * Met à jour le statut à BUSY si le driver était ONLINE.
     */
    async addOrderToDriver(driverId: string, orderId: string, nextDestination?: { lat: number, lng: number }): Promise<void> {
        const state = await this.getDriverState(driverId)
        if (!state) return

        const currentOrders = state.current_orders || []
        if (!currentOrders.includes(orderId)) {
            currentOrders.push(orderId)
        }

        await this.updateDriverState(driverId, {
            current_orders: currentOrders,
            status: 'BUSY',
            next_destination: nextDestination
        })
    }

    /**
     * Retire un ordre de la liste des ordres en cours d'un driver.
     * Remet le statut à ONLINE si la liste devient vide.
     */
    async removeOrderFromDriver(driverId: string, orderId: string): Promise<void> {
        const state = await this.getDriverState(driverId)
        if (!state) return

        const currentOrders = (state.current_orders || []).filter(id => id !== orderId)

        // Déterminer le nouveau statut
        const newStatus = currentOrders.length === 0 ? 'ONLINE' : 'BUSY'

        await this.updateDriverState(driverId, {
            current_orders: currentOrders,
            status: newStatus,
            // Effacer la destination si plus de commandes
            next_destination: currentOrders.length === 0 ? undefined : state.next_destination
        })
    }

    /**
     * Vérifie si un driver peut accepter une nouvelle commande chaînée.
     */
    canAcceptChainedOrder(state: CondensedDriverState): boolean {
        if (!state.allow_chaining) return false
        return (state.current_orders?.length || 0) < MAX_CONCURRENT_ORDERS
    }

    /**
     * Acquire simple lock (pour éviter les race conditions)
     * TTL par défaut de 5 secondes pour éviter les blocages infinis
     */
    async acquireLock(resource: string, ttlSeconds: number = 5): Promise<boolean> {
        const lockKey = `sublymus:lock:${resource}`
        const result = await redis.set(lockKey, 'locked', 'EX', ttlSeconds, 'NX')
        return result === 'OK'
    }

    /**
     * Release lock
     */
    async releaseLock(resource: string): Promise<void> {
        const lockKey = `sublymus:lock:${resource}`
        await redis.del(lockKey)
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
     *TODO:OPTIMISER Synchronise un driver spécifique de SQL vers Redis
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
            allow_chaining: driver.allowChaining ?? true, // Default to true
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
