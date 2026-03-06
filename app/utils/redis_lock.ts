import redis from '@adonisjs/redis/services/main'

export default class RedisLock {
    /**
     * Acquires a lock for a given key.
     * @param key The lock key.
     * @param ttl Total time to live in milliseconds.
     * @returns A boolean indicating if the lock was acquired.
     */
    static async acquire(key: string, ttl: number = 5000): Promise<boolean> {
        const fullKey = `lock:${key}`
        const result = await redis.set(fullKey, 'locked', 'PX', ttl, 'NX')
        return result === 'OK'
    }

    /**
     * Releases a lock for a given key.
     * @param key The lock key.
     */
    static async release(key: string): Promise<void> {
        const fullKey = `lock:${key}`
        await redis.del(fullKey)
    }

    /**
     * Executes a callback within a lock.
     * @param key The lock key.
     * @param callback The function to execute.
     * @param ttl Total time to live in milliseconds.
     * @param retryCount Number of retries if lock is busy.
     * @param retryDelay Delay between retries in milliseconds.
     */
    static async runWithLock<T>(
        key: string,
        callback: () => Promise<T>,
        ttl: number = 10000,
        retryCount: number = 5,
        retryDelay: number = 200
    ): Promise<T> {
        let attempts = 0
        while (attempts < retryCount) {
            if (await this.acquire(key, ttl)) {
                try {
                    return await callback()
                } finally {
                    await this.release(key)
                }
            }
            attempts++
            if (attempts < retryCount) {
                await new Promise((resolve) => setTimeout(resolve, retryDelay))
            }
        }
        throw new Error(`E_LOCK_BUSY: Impossible d'acquérir le verrou pour ${key} après ${retryCount} tentatives.`)
    }
}
