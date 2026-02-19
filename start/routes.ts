/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

// Import route modules
import './routes/auth.js'
import './routes/users.js'
import './routes/logistics.js'
import './routes/admin.js'
import './routes/core.js'
import './routes/external.js'
import './routes/zones.js'
import './routes/documents.js'
import './routes/missions.js'
import './routes/payments.js'
import './routes/driver_payments.js'

// --- PUBLIC ROUTES ---
router.get('/', async () => {
  return { status: 'ok', service: 'Sublymus Delivery API', version: '1.0.0' }
})

const DriverController = () => import('#controllers/driver_controller')
router.get('/v1/drivers/locations', [DriverController, 'getAllDriversLocations'])
router.get('/v1/driver/:id/location', [DriverController, 'getDriverLocation'])
