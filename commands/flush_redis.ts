import redis from '@adonisjs/redis/services/main'
import { BaseCommand } from '@adonisjs/core/ace'

export default class FlushRedis extends BaseCommand {
    static commandName = 'redis:flush'
    static description = 'Flush all Redis data'

    async run() {
        await redis.flushall()
        this.logger.info('Redis flushed successfully')
    }
}
