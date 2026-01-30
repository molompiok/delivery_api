import redis from '@adonisjs/redis/services/main'
import logger from '@adonisjs/core/services/logger'
import GeoService from '#services/geo_service'
import SecurityLog from '#models/security_log'
import WsService from '#services/ws_service'
import { apiConfig } from '#config/api_config'

interface SearchPayload {
    query: string
    requestId: string | number
    timestamp?: number
}

class LocationSearchService {
    private queueKey = 'pending_searches'
    private processingInterval: NodeJS.Timeout | null = null
    private RATE_LIMIT_WINDOW = apiConfig.search_place.rateLimit.window
    private RATE_LIMIT_MAX = apiConfig.search_place.rateLimit.maxRequests

    /**
     * Starts the worker loop that processes the queue.
     */
    public startWorker() {
        if (this.processingInterval) return

        logger.info('Starting LocationSearchService worker...')
        this.processingInterval = setInterval(() => {
            this.processQueue()
        }, apiConfig.search_place.rateLimit.batchInterval || 500)
    }

    /**
     * Adds a search request to the Redis queue.
     * Handles Rate Limiting before queueing.
     */
    public async addToQueue(socketId: string, payload: SearchPayload) {
        if (!payload.query || payload.query.length < 3) return

        // 1. Rate Limiting
        const rateLimitKey = `rate_limit:${socketId}`
        const currentUsage = await redis.incr(rateLimitKey)
        if (currentUsage === 1) {
            await redis.expire(rateLimitKey, this.RATE_LIMIT_WINDOW)
        }

        if (currentUsage > this.RATE_LIMIT_MAX) {
            if (currentUsage === this.RATE_LIMIT_MAX + 1) {
                // Log only once per window when limit is first exceeded
                await SecurityLog.create({
                    type: 'RATE_LIMIT_EXCEEDED',
                    severity: 'WARNING',
                    source: 'SOCKET',
                    ipAddress: 'unknown', // Socket ID is generic, would need IP from handshake
                    details: `SocketID ${socketId} exceeded limit`,
                    metaData: { socketId, limit: this.RATE_LIMIT_MAX, payload },
                })
                logger.warn({ socketId }, 'Rate limit exceeded for location search')
            }
            // Emit error to user?
            // WsService.emitToRoom(socketId, 'search_error', { code: 'RATE_LIMIT', requestId: payload.requestId })
            return
        }

        // 2. Add to Queue (Deduplication by SocketID)
        // We store the whole payload as JSON strings
        // HSET overwrites pending request for this user which gives us "Server-Side Debounce"
        await redis.hset(this.queueKey, socketId, JSON.stringify(payload))
        // Set a short expire on the queue key to avoid zombies if worker dies
        await redis.expire(this.queueKey, 5)
    }

    /**
     * Processes all pending requests in the queue.
     */
    public async processQueue() {
        try {
            // Atomic get and clear the hash
            // Using a pipeline/transaction manually:
            // watch -> multi -> hgetall -> del -> exec
            // Or just hgetall then del? 
            // Redis transaction is safer to avoid losing data between read and delete if new data comes in.
            // But simple: Rename key? 

            const tempKey = `${this.queueKey}:processing:${Date.now()}`

            // Rename is atomic. If key doesn't exist (empty queue), rename fails.
            // TODO: CRITICAL - Data Safety Trade-off
            // If the server crashes after rename but before processing completes,
            // the requests in 'tempKey' are lost. Accepted risk for transient search queries.
            const exists = await redis.exists(this.queueKey)
            if (!exists) return

            await redis.rename(this.queueKey, tempKey)

            const requests = await redis.hgetall(tempKey)
            await redis.del(tempKey) // Cleanup

            if (!requests || Object.keys(requests).length === 0) return

            // Process in parallel
            const promises = Object.entries(requests).map(async ([socketId, payloadStr]) => {
                try {
                    const payload = JSON.parse(payloadStr) as SearchPayload
                    const normalizedQuery = payload.query.trim().toLowerCase()
                    const cacheKey = `loc_search:${Buffer.from(normalizedQuery).toString('base64')}`

                    // 1. Check Cache
                    let results = await redis.get(cacheKey)
                    let data: any[] | null = null

                    if (results) {
                        logger.info({ cacheKey }, 'Cache hit for search')
                        data = JSON.parse(results)
                    } else {
                        logger.info({ cacheKey }, 'Cache miss, querying providers')
                        // 2. Provider Search based on Config Order
                        data = [] // Default

                        logger.info({ providerOrder: apiConfig.search_place.providerOrder }, 'Processing search with provider order')

                        for (const provider of apiConfig.search_place.providerOrder) {
                            logger.info({ provider }, 'Trying provider')
                            if (provider === 'nominatim') {
                                const res = await GeoService.searchPlaces(payload.query)
                                if (res && res.length > 0) {
                                    logger.info({ provider, count: res.length }, 'Got results from provider')
                                    data = res
                                    break // Found results, stop chain (Network saving)
                                }
                            } else if (provider === 'google') {
                                const res = await GeoService.searchPlacesGoogle(payload.query)
                                if (res && res.length > 0) {
                                    logger.info({ provider, count: res.length }, 'Got results from provider')
                                    data = res
                                    break
                                } else {
                                    logger.warn({ provider }, 'Provider returned no results')
                                }
                            }
                        }

                        // Cache result
                        if (data && data.length > 0) {
                            await redis.setex(cacheKey, 3600 * 24, JSON.stringify(data))
                        }
                    }

                    // 3. Emit Result
                    if (WsService.io) {
                        WsService.io.to(socketId).emit('search_result', {
                            requestId: payload.requestId,
                            results: data || []
                        })
                    }

                } catch (err) {
                    logger.error({ err, socketId }, 'Error processing individual search request')
                }
            })

            await Promise.all(promises)

        } catch (error) {
            // If rename fails (key gone), ignore. Other errors log.
            if (!error.message.includes('no such key')) {
                logger.error({ error }, 'Error in LocationSearchService processQueue')
            }
        }
    }
}

export default new LocationSearchService()
