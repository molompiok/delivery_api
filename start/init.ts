import RedisService from '#services/redis_service'

/**
 * Initialisation au démarrage de l'application
 */
export default async function initialize() {
    console.log('[INIT] Initializing application services...')

    try {
        // Warm up Redis with driver states
        await RedisService.syncAllDriversToRedis()
    } catch (error) {
        console.error('[INIT] Error during initialization:', error)
    }
}
