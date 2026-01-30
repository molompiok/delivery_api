import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const OrdersController = () => import('#controllers/orders_controller')
const MissionsController = () => import('#controllers/missions_controller')
const IdepVehicleController = () => import('#controllers/idep_vehicle_controller')

router.group(() => {
    // Orders
    router.get('/orders', [OrdersController, 'index'])
    router.post('/orders', [OrdersController, 'store'])
    router.post('/orders/complex', [OrdersController, 'storeComplex'])
    router.post('/orders/estimate', [OrdersController, 'estimate'])
    router.get('/orders/:id', [OrdersController, 'show'])
    router.post('/orders/:id/cancel', [OrdersController, 'cancel'])

    // Missions
    router.get('/missions/me', [MissionsController, 'list'])
    router.post('/missions/:id/accept', [MissionsController, 'accept'])
    router.post('/missions/:id/refuse', [MissionsController, 'refuse'])
    router.patch('/missions/:id/status', [MissionsController, 'updateStatus'])

    // IDEP Vehicles
    router.get('/idep/vehicles', [IdepVehicleController, 'index'])
    router.post('/idep/vehicles', [IdepVehicleController, 'store'])
    router.get('/idep/vehicles/:id', [IdepVehicleController, 'show'])
    router.put('/idep/vehicles/:id', [IdepVehicleController, 'update'])
    router.post('/idep/vehicles/:id/upload-doc', [IdepVehicleController, 'uploadDoc'])
})
    .prefix('/v1')
    .use(middleware.auth())
