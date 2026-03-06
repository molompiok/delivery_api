/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import fs from 'node:fs'
import app from '@adonisjs/core/services/app'
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

// --- STATIC SERVING FOR TEST CLIENT ---
// We use a wildcard and a base route. Both serve index.html for navigation.
// The <base href="/client/"> in index.html handles relative asset paths.

const serveClient = async ({ request, response }: any) => {
  const parts = request.param('*') || []
  let filename = Array.isArray(parts) ? parts.join('/') : parts

  if (!filename || filename === '/') {
    filename = 'index.html'
  }

  const filePath = app.makePath('test-client', filename)
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return response.download(filePath)
  }

  // SPA Fallback
  return response.download(app.makePath('test-client', 'index.html'))
}

router.get('/client/*', serveClient)
router.get('/client', serveClient)
