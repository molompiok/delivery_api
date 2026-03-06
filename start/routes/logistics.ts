import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const OrdersController = () => import('#controllers/orders_controller')
const IdepVehicleController = () => import('#controllers/idep_vehicle_controller')
const StepsController = () => import('#controllers/steps_controller')
const StopsController = () => import('#controllers/stops_controller')
const ActionsController = () => import('#controllers/actions_controller')
const TransitItemsController = () => import('#controllers/transit_items_controller')
const GeoController = () => import('#controllers/geo_controller')

const VoyagesController = () => import('#controllers/voyages_controller')
const BookingsController = () => import('#controllers/bookings_controller')
const CompanyB2BsController = () => import('#controllers/company_b_2_bs_controller')

const CompanyController = () => import('#controllers/company_controller')

// --- PUBLIC COMPANY SEARCH ---
router.group(() => {
    router.get('/companies/search', [CompanyController, 'searchPublic'])
}).prefix('/v1')

// --- PUBLIC VOYAGE ROUTES ---
router.group(() => {
    router.get('/voyages', [VoyagesController, 'index'])
    router.get('/voyages/:id', [VoyagesController, 'show'])
    router.get('/voyages/:id/seats', [VoyagesController, 'seats'])
}).prefix('/v1')

// --- AUTH PROTECTED ROUTES ---
router.group(() => {
    // Geo / Places
    router.get('/geo/reverse', [GeoController, 'reverseGeocode'])

    // Orders
    router.get('/orders', [OrdersController, 'index'])
    router.post('/orders', [OrdersController, 'store'])
    router.post('/orders/initiate', [OrdersController, 'initiate'])
    router.post('/orders/:id/submit', [OrdersController, 'submit'])
    router.post('/orders/:id/publish', [OrdersController, 'publish']) // New: Publish VOYAGE
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

    // Bookings
    router.get('/bookings', [BookingsController, 'index'])
    router.post('/voyages/:id/bookings', [BookingsController, 'store'])

    // Granular Order Management
    router.post('/orders/:orderId/steps', [StepsController, 'store'])
    router.patch('/steps/:id', [StepsController, 'update'])
    router.delete('/steps/:id', [StepsController, 'destroy'])

    router.post('/steps/:stepId/stops', [StopsController, 'store'])
    router.patch('/stops/:id', [StopsController, 'update'])
    router.delete('/stops/:id', [StopsController, 'destroy'])
    router.post('/stops/:id/restore-price', [StopsController, 'restorePrice'])

    router.post('/stops/:stopId/actions', [ActionsController, 'store'])
    router.patch('/actions/:id', [ActionsController, 'update'])
    router.delete('/actions/:id', [ActionsController, 'destroy'])

    router.patch('/items/:id', [TransitItemsController, 'update'])

    // Company B2B Partners
    router.get('/companies/:companyId/b2b-clients', [CompanyB2BsController, 'index'])
    router.post('/companies/:companyId/b2b-clients', [CompanyB2BsController, 'store'])
    router.patch('/companies/:companyId/b2b-clients/:id', [CompanyB2BsController, 'update'])
    router.delete('/companies/:companyId/b2b-clients/:id', [CompanyB2BsController, 'destroy'])

    // IDEP Vehicles
    router.get('/idep/vehicles', [IdepVehicleController, 'index'])
    router.post('/idep/vehicles', [IdepVehicleController, 'store'])
    router.get('/idep/vehicles/:id', [IdepVehicleController, 'show'])
    router.put('/idep/vehicles/:id', [IdepVehicleController, 'update'])
    router.post('/idep/vehicles/:id/upload-doc', [IdepVehicleController, 'uploadDoc'])
})
    .prefix('/v1')
    .use(middleware.auth())
