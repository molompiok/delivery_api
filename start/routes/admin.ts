import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const AdminController = () => import('#controllers/admin_controller')
const VerificationController = () => import('#controllers/verification_controller')

router.group(() => {
    // Admin Routes
    router.post('/admin/promote', [AdminController, 'promoteToAdmin'])
    router.get('/admin/list', [AdminController, 'listAdmins'])

    // Verification Endpoints (Admin)
    router.group(() => {
        // Verifications (Sublymus Admin)
        router.get('/verifications/drivers', [VerificationController, 'pendingDrivers'])
        router.get('/verifications/drivers/:driverId', [VerificationController, 'getDriverDetail'])
        router.get('/verifications/vehicles', [VerificationController, 'pendingVehicles'])
        router.get('/verifications/companies', [VerificationController, 'pendingCompanies'])
        router.get('/companies', [VerificationController, 'listCompanies'])
        router.get('/companies/:companyId', [VerificationController, 'getCompanyDetail'])
        router.post('/companies/:companyId/impersonate', [VerificationController, 'impersonate'])
        router.post('/drivers/documents/:docId/validate', [VerificationController, 'validateDocument'])
        router.post('/drivers/:driverId/verify', [VerificationController, 'verifyDriver'])
        router.post('/companies/:companyId/verify', [VerificationController, 'verifyCompany'])
    }).prefix('/admin').use(({ auth, response }, next) => {
        if (!auth.user?.isAdmin) {
            return response.forbidden({ message: 'Admin access required' })
        }
        return next()
    })
})
    .prefix('/v1')
    .use(middleware.auth())
