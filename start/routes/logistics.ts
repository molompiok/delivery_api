import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const OrdersController = () => import('#controllers/orders_controller')
const IdepVehicleController = () => import('#controllers/idep_vehicle_controller')
const StepsController = () => import('#controllers/steps_controller')
const StopsController = () => import('#controllers/stops_controller')
const ActionsController = () => import('#controllers/actions_controller')
const TransitItemsController = () => import('#controllers/transit_items_controller')
const GeoController = () => import('#controllers/geo_controller')

router.group(() => {
    // Geo / Places
    router.get('/geo/reverse', [GeoController, 'reverseGeocode'])

    // Orders
    router.get('/orders', [OrdersController, 'index'])
    router.post('/orders', [OrdersController, 'store'])
    router.post('/orders/initiate', [OrdersController, 'initiate'])
    router.post('/orders/:id/submit', [OrdersController, 'submit'])
    router.post('/orders/:id/push-updates', [OrdersController, 'pushUpdates'])
    router.post('/orders/:id/revert', [OrdersController, 'revertChanges'])
    router.get('/orders/:id/estimate-draft', [OrdersController, 'estimateDraft'])
    router.post('/orders/:id/items', [OrdersController, 'addItem'])
    router.post('/orders/complex', [OrdersController, 'store'])
    router.post('/orders/estimate', [OrdersController, 'estimate'])
    router.get('/orders/:id', [OrdersController, 'show'])
    router.get('/orders/:id/route', [OrdersController, 'route'])
    router.post('/orders/:id/cancel', [OrdersController, 'cancel'])
    router.patch('/orders/:id', [OrdersController, 'update'])
    router.post('/orders/:id/driver/next-stop', [OrdersController, 'setNextStop'])
    router.post('/orders/:id/recalculate', [OrdersController, 'recalculate'])

    // Granular Order Management
    router.post('/orders/:orderId/steps', [StepsController, 'store'])
    router.patch('/steps/:id', [StepsController, 'update'])
    router.delete('/steps/:id', [StepsController, 'destroy'])

    router.post('/steps/:stepId/stops', [StopsController, 'store'])
    router.patch('/stops/:id', [StopsController, 'update'])
    router.delete('/stops/:id', [StopsController, 'destroy'])

    router.post('/stops/:stopId/actions', [ActionsController, 'store'])
    router.patch('/actions/:id', [ActionsController, 'update'])
    router.delete('/actions/:id', [ActionsController, 'destroy'])

    router.patch('/items/:id', [TransitItemsController, 'update'])


    // IDEP Vehicles
    router.get('/idep/vehicles', [IdepVehicleController, 'index'])
    router.post('/idep/vehicles', [IdepVehicleController, 'store'])
    router.get('/idep/vehicles/:id', [IdepVehicleController, 'show'])
    router.put('/idep/vehicles/:id', [IdepVehicleController, 'update'])
    router.post('/idep/vehicles/:id/upload-doc', [IdepVehicleController, 'uploadDoc'])
})
    .prefix('/v1')
    .use(middleware.auth())
