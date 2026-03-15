import redis from '@adonisjs/redis/services/main'

export interface CachedCheckoutPayload {
  checkoutUrl: string
  externalId: string
  expiresAt: string
}

class PaymentCheckoutCacheService {
  private readonly prefix = 'payment:checkout:'

  private get defaultTtlSeconds(): number {
    const raw = Number(process.env.PAYMENT_CHECKOUT_CACHE_TTL_SECONDS || 600)
    if (!Number.isFinite(raw) || raw < 60) return 600
    return Math.floor(raw)
  }

  public async get(intentId: string): Promise<CachedCheckoutPayload | null> {
    const raw = await redis.get(`${this.prefix}${intentId}`)
    if (!raw) return null

    let payload: CachedCheckoutPayload
    try {
      payload = JSON.parse(raw) as CachedCheckoutPayload
    } catch {
      await this.clear(intentId)
      return null
    }

    if (!payload.checkoutUrl || !payload.externalId || !payload.expiresAt) {
      await this.clear(intentId)
      return null
    }

    if (new Date(payload.expiresAt).getTime() <= Date.now()) {
      await this.clear(intentId)
      return null
    }

    return payload
  }

  public async set(intentId: string, payload: CachedCheckoutPayload) {
    const expiresAtMs = new Date(payload.expiresAt).getTime()
    const ttlFromExpiry = Number.isFinite(expiresAtMs)
      ? Math.floor((expiresAtMs - Date.now()) / 1000)
      : this.defaultTtlSeconds
    const ttlSeconds = Math.max(1, Math.min(this.defaultTtlSeconds, ttlFromExpiry))

    await redis.set(`${this.prefix}${intentId}`, JSON.stringify(payload), 'EX', ttlSeconds)
  }

  public async clear(intentId: string) {
    await redis.del(`${this.prefix}${intentId}`)
  }
}

export default new PaymentCheckoutCacheService()
