import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const ZonesController = () => import('#controllers/zones_controller')

router.group(() => {
    router.get('/zones', [ZonesController, 'index'])
    router.post('/zones', [ZonesController, 'store'])
    router.get('/zones/:id', [ZonesController, 'show'])
    router.patch('/zones/:id', [ZonesController, 'update'])
    router.delete('/zones/:id', [ZonesController, 'destroy'])

    // Get active drivers for a zone
    router.get('/zones/:id/drivers', [ZonesController, 'getActiveDrivers'])

    // Install a Sublymus zone (Company copies it)
    router.post('/zones/:id/install', [ZonesController, 'installFromSublymus'])

    // Active zone management (ETP - Company Manager sets driver's active zone)
    router.post('/zones/:id/set-active-etp', [ZonesController, 'setActiveZoneETP'])
    router.post('/zones/clear-active-etp', [ZonesController, 'clearActiveZoneETP'])

    // Active zone management (IDEP - Driver sets their own active zone)
    router.post('/zones/:id/set-active-idep', [ZonesController, 'setActiveZoneIDEP'])
    router.post('/zones/clear-active-idep', [ZonesController, 'clearActiveZoneIDEP'])
})
    .prefix('/v1')
    .use(middleware.auth())
