import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const OrdersController = () => import('#controllers/orders_controller')
const MissionsController = () => import('#controllers/missions_controller')

router.group(() => {
    // Orders
    router.get('/orders', [OrdersController, 'index'])
    router.post('/orders', [OrdersController, 'store'])
    router.get('/orders/:id', [OrdersController, 'show'])
    router.post('/orders/:id/cancel', [OrdersController, 'cancel'])

    // Missions
    router.get('/missions/me', [MissionsController, 'show'])
    router.post('/missions/:id/accept', [MissionsController, 'accept'])
    router.post('/missions/:id/refuse', [MissionsController, 'refuse'])
    router.patch('/missions/:id/status', [MissionsController, 'updateStatus'])
})
    .prefix('/v1')
    .use(middleware.auth())
