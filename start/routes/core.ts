import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const ScheduleController = () => import('#controllers/schedule_controller')
const AddressController = () => import('#controllers/address_controller')
const VehicleController = () => import('#controllers/vehicle_controller')
const VehicleDocumentController = () => import('#controllers/vehicle_document_controller')
const StorageController = () => import('#controllers/storage_controller')

// Public File Access (permission check handled inside controller)
router.get('/fs/:filename', [StorageController, 'serve'])

router.group(() => {
    // Get temporary access token for a file
    router.get('/fs/token/:filename', [StorageController, 'getToken'])

    // Schedules (Universal)
    router.get('/schedules', [ScheduleController, 'index'])
    router.post('/schedules', [ScheduleController, 'store'])
    router.get('/schedules/availability', [ScheduleController, 'checkAvailability'])
    router.get('/schedules/calendar', [ScheduleController, 'getCalendarView'])
    router.get('/schedules/:id', [ScheduleController, 'show'])
    router.put('/schedules/:id', [ScheduleController, 'update'])
    router.delete('/schedules/:id', [ScheduleController, 'destroy'])
    router.post('/schedules/:id/assign-users', [ScheduleController, 'assignUsers'])
    router.delete('/schedules/:id/unassign-users', [ScheduleController, 'unassignUsers'])
    router.get('/schedules/:id/assigned-users', [ScheduleController, 'getAssignedUsers'])

    // Addresses (Polymorphic)
    router.get('/addresses', [AddressController, 'index'])
    router.post('/addresses', [AddressController, 'store'])
    router.put('/addresses/:id', [AddressController, 'update'])
    router.delete('/addresses/:id', [AddressController, 'destroy'])
    router.post('/addresses/:id/set-default', [AddressController, 'setDefault'])

    // Vehicles (Polymorphic)
    router.get('/vehicles', [VehicleController, 'index'])
    router.get('/vehicles/:id', [VehicleController, 'show'])
    router.post('/vehicles', [VehicleController, 'store'])
    router.put('/vehicles/:id', [VehicleController, 'update'])
    router.delete('/vehicles/:id', [VehicleController, 'destroy'])
    router.post('/vehicles/:id/assign-driver', [VehicleController, 'assignDriver'])  // Legacy
    router.get('/vehicles/:id/orders', [VehicleController, 'listOrders'])
    router.post('/vehicles/:id/documents', [VehicleController, 'uploadDoc'])

    // Active Vehicle Management (like Zones)
    router.post('/vehicles/:id/set-active-etp', [VehicleController, 'setActiveVehicleETP'])
    router.post('/vehicles/clear-active-etp', [VehicleController, 'clearActiveVehicleETP'])
    router.post('/vehicles/:id/set-active-idep', [VehicleController, 'setActiveVehicleIDEP'])
    router.post('/vehicles/clear-active-idep', [VehicleController, 'clearActiveVehicleIDEP'])
    router.get('/vehicles/:id/driver', [VehicleController, 'getActiveDriver'])

    // Vehicle Documents (Admin validation)
    router.post('/vehicle-documents/:docId/validate', [VehicleDocumentController, 'validate'])
})
    .prefix('/v1')
    .use(middleware.auth())
