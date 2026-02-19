import RedisService from '#services/redis_service'
import GeoService from '#services/geo_service'
import Order from '#models/order'
import logger from '@adonisjs/core/services/logger'

export class NavigationService {
    /**
     * Récupère ou calcule le tracé de navigation immédiat (nav_trace)
     * entre la position actuelle du chauffeur et le prochain arrêt.
     */
    async getNavTrace(
        orderId: string,
        lat: number,
        lng: number,
        forceCalculate: boolean = false
    ): Promise<any | null> {
        // logger.info({ orderId, lat, lng, forceCalculate }, '[NAV_SERVICE] getNavTrace called')
        try {
            // 1. Vérifier le cache si pas forcé
            if (!forceCalculate) {
                const cached = await RedisService.getOrderNavTrace(orderId)
                if (cached) return cached
            }

            // 2. Identifier le prochain arrêt
            const order = await Order.findOrFail(orderId)
            const remainingStops = order.metadata?.route_execution?.remaining as string[] | undefined
            const visitedStops = order.metadata?.route_execution?.visited as string[] | undefined

            // logger.info({ orderId, remainingCount: remainingStops?.length, visitedCount: visitedStops?.length }, '[NAV_SERVICE] Checking stops for target selection')

            let nextStopId: string | null = null

            // LOGIQUE : 
            // 1. Si le dernier arrêt visité est au statut "ARRIVED", on le prend comme référence (le chauffeur y est mais n'a pas fini)
            if (visitedStops && visitedStops.length > 0) {
                const lastVisitedId = visitedStops[visitedStops.length - 1]
                const Stop = (await import('#models/stop')).default
                const lastStop = await Stop.find(lastVisitedId)

                if (lastStop && lastStop.status === 'ARRIVED') {
                    // logger.info({ orderId, lastVisitedId }, '[NAV_SERVICE] Last visited stop is still ARRIVED, using it as target')
                    nextStopId = lastVisitedId
                }
            }

            // 2. Sinon, on prend le premier des arrêts restants
            if (!nextStopId && remainingStops && remainingStops.length > 0) {
                nextStopId = remainingStops[0]
                // logger.info({ orderId, nextStopId }, '[NAV_SERVICE] Using first remaining stop as target')
            }

            if (!nextStopId) {
                // logger.warn({ orderId, metadata: order.metadata }, '[NAV_SERVICE] No target stop found (all done or empty)')
                return null
            }

            const Stop = (await import('#models/stop')).default
            const nextStop = await Stop.query()
                .where('id', nextStopId)
                .preload('address')
                .first()

            if (!nextStop || !nextStop.address) {
                // logger.warn({ orderId, nextStopId, stopFound: !!nextStop, addressFound: !!nextStop?.address }, '[NAV_SERVICE] Next stop or address not found')
                return null
            }

            // 3. Calculer via Valhalla (GeoService)
            // logger.info({ orderId, nextStopId, lat, lng, destLat: nextStop.address.lat, destLng: nextStop.address.lng }, '[NAV_SERVICE] Calculating via Valhalla')
            const routeInfo = await GeoService.getDirectRouteInfo(
                [lng, lat],
                [nextStop.address.lng, nextStop.address.lat]
            )

            if (!routeInfo) {
                logger.error({ orderId, nextStopId }, '[NAV_SERVICE] Valhalla returned no route info')
                return null
            }

            const navTrace = {
                geometry: routeInfo.geometry,
                duration_seconds: routeInfo.durationSeconds,
                distance_meters: routeInfo.distanceMeters,
                target_stop_id: nextStopId,
                calculated_at: new Date().toISOString()
            }

            // 4. Mettre en cache
            await RedisService.setOrderNavTrace(orderId, navTrace)

            return navTrace
        } catch (error) {
            logger.error({ err: error, orderId }, '[NAV_SERVICE] Failed to get nav_trace')
            return null
        }
    }

    /**
     * Invalide le cache nav_trace pour une commande
     */
    async invalidateNavTrace(orderId: string): Promise<void> {
        await RedisService.clearOrderNavTrace(orderId)
    }
}

export default new NavigationService()
