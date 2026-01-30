import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const MissionsController = () => import('#controllers/missions_controller')

router
    .group(() => {
        // Mission management (driver endpoints)
        router.get('/missions', [MissionsController, 'list'])
        router.post('/missions/:id/accept', [MissionsController, 'accept'])
        router.post('/missions/:id/refuse', [MissionsController, 'refuse'])
        router.post('/missions/:id/status', [MissionsController, 'updateStatus'])
        router.post('/missions/:id/verify-code', [MissionsController, 'verifyCode'])
    })
    .prefix('/api/v1')
    .use(middleware.auth())
