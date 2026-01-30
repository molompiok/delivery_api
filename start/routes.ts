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

// --- PUBLIC ROUTES ---
router.get('/', async () => {
  return { status: 'ok', service: 'Sublymus Delivery API', version: '1.0.0' }
})
