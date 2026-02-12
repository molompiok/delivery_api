import RedisService from '#services/redis_service'
import redis from '@adonisjs/redis/services/main'
import OrderLeg from '#models/order_leg'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import logger from '@adonisjs/core/services/logger'

export class RouteService {
    /**
     * Cache une route optimisée dans Redis
     */
    async cacheOptimizedRoute(orderId: string, routeData: any): Promise<void> {
        const key = `order:route:optimized:${orderId}`
        // Mise en cache pour 2 heures
        await redis.set(key, JSON.stringify(routeData), 'EX', 7200)
    }

    /**
     * Récupère la route depuis le cache Redis
     */
    async getCachedRoute(orderId: string): Promise<any | null> {
        const key = `order:route:optimized:${orderId}`
        const cached = await redis.get(key)
        return cached ? JSON.parse(cached) : null
    }

    /**
     * Transfère les points GPS de Redis (Trace buffer) vers le tracé réel en DB
     * Utilise une lecture sans suppression (PEEK) puis supprime APRES commit (via hook).
     */
    async flushTraceToLeg(orderId: string, legId: string, trx?: TransactionClientContract): Promise<void> {
        const db = (await import('@adonisjs/lucid/services/db')).default
        const effectiveTrx = trx || await db.transaction()

        try {
            // 1. Lire sans supprimer (Safe Peek)
            const rawPoints = await RedisService.peekOrderTrace(orderId)
            if (!rawPoints || rawPoints.length === 0) {
                if (!trx) await effectiveTrx.commit()
                return
            }

            const points = rawPoints.map(p => JSON.parse(p)) // [lng, lat, ts]
            const newCoordinates = points.map(p => [p[0], p[1]])

            const leg = await OrderLeg.findOrFail(legId, { client: effectiveTrx })

            // Fusionner avec l'existant
            let fullCoordinates = [...(leg.actualPath?.coordinates || []), ...newCoordinates]

            // 2. SIMPLIFICATION : Réduire le nombre de points
            if (fullCoordinates.length > 20) {
                fullCoordinates = this.simplifyTrace(fullCoordinates, 0.00005) // ~5 mètres de tolérance
            }

            leg.actualPath = {
                type: 'LineString',
                coordinates: fullCoordinates
            }

            await leg.useTransaction(effectiveTrx).save();
            logger.info({ orderId: orderId as any, legId: legId as any, pointsCount: points.length as any }, 'GPS Trace flushed from Redis to DB');

            // 3. Supprimer de Redis UNIQUEMENT si la transaction réussit
            (effectiveTrx as any).after('commit', async () => {
                try {
                    await RedisService.clearOrderTraceAfterFlush(orderId)
                    logger.debug({ orderId }, 'Redis trace buffer cleared after commit')
                } catch (e) {
                    logger.error({ err: e, orderId }, 'Failed to clear Redis trace buffer after commit')
                }
            });

            if (!trx) await effectiveTrx.commit()

        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            logger.error({ err: error, orderId, legId }, 'Failed to flush GPS trace to leg')
            // Ne pas throw ici pour ne pas bloquer le flow principal (arrivedAtStop)
        }
    }

    /**
     * Simplification de trace (Algorithme naïf ou Douglas-Peucker simple)
     * Ici: une implémentation simple basée sur la distance euclidienne carrée pour la rapidité
     */
    private simplifyTrace(points: number[][], tolerance: number): number[][] {
        if (points.length <= 2) return points

        const sqTolerance = tolerance * tolerance
        let lastPoint = points[0]
        const simplified = [lastPoint]

        for (let i = 1; i < points.length - 1; i++) {
            const point = points[i]
            // Distance carrée simple (suffisant pour lat/lng à petite échelle)
            const dx = point[0] - lastPoint[0]
            const dy = point[1] - lastPoint[1]
            const sqDist = dx * dx + dy * dy

            if (sqDist > sqTolerance) {
                simplified.push(point)
                lastPoint = point
            }
        }

        simplified.push(points[points.length - 1])
        return simplified
    }

    /**
     * Récupère le tracé réel complet (DB + Redis Buffer)
     */
    async getActualTrace(orderId: string): Promise<number[][]> {
        // 1. Récupérer les segments archivés en DB
        const legs = await OrderLeg.query()
            .where('orderId', orderId)

        let fullPath: number[][] = []
        for (const leg of legs) {
            if (leg.actualPath?.coordinates) {
                fullPath = [...fullPath, ...leg.actualPath.coordinates]
            }
        }

        // 2. Ajouter les points encore en buffer dans Redis
        const buffer = await RedisService.getOrderTrace(orderId)
        if (buffer.length > 0) {
            const bufferCoords = buffer.map(p => [p[0], p[1]])
            fullPath = [...fullPath, ...bufferCoords]
        }

        return fullPath
    }
}

export default new RouteService()
