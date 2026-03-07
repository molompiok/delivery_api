import { defineConfig } from '@adonisjs/transmit'
import env from '#start/env'
import { redis } from '@adonisjs/transmit/transports'

export default defineConfig({
  pingInterval: false,
  transport: {
    driver: redis({
      host: env.get('REDIS_HOST', '127.0.0.1'),
      port: env.get('REDIS_PORT', 6379),
      password: env.get('REDIS_PASSWORD', ''),
    }),
  },
})

