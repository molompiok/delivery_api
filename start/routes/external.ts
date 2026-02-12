import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

router
    .group(() => {
        // Test route for API Key auth
        router.get('/test-key', async () => {
            return { message: 'Api Key Auth Working' }
        }).use(middleware.api())
    })
    .prefix('/v1/external')
