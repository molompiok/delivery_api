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
        router.post('/missions/:id/finish', [MissionsController, 'finish'])

        router.post('/stops/:stopId/arrival', [MissionsController, 'arrivedAtStop'])
        router.post('/stops/:stopId/complete', [MissionsController, 'completeStop'])
        router.post('/stops/:stopId/freeze', [MissionsController, 'freezeStop'])
        router.post('/stops/:stopId/unfreeze', [MissionsController, 'unfreezeStop'])
        router.post('/actions/:actionId/complete', [MissionsController, 'completeAction'])
        router.post('/actions/:actionId/freeze', [MissionsController, 'freezeAction'])
        router.post('/actions/:actionId/unfreeze', [MissionsController, 'unfreezeAction'])
    })
    .prefix('/v1')
    .use(middleware.auth())
