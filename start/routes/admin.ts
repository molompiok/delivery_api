import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const AdminController = () => import('#controllers/admin_controller')
const VerificationController = () => import('#controllers/verification_controller')
const SubscriptionAdminController = () => import('#controllers/subscription_admin_controller')
const AdminNotificationsController = () => import('#controllers/admin_notifications_controller')

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

        // Subscription management (dynamic, admin-driven)
        router.get('/subscriptions/plans', [SubscriptionAdminController, 'listPlans'])
        router.put('/subscriptions/plans/:activityType', [SubscriptionAdminController, 'upsertPlan'])

        router.get('/subscriptions/overrides', [SubscriptionAdminController, 'listOverrides'])
        router.put('/subscriptions/overrides/:companyId', [SubscriptionAdminController, 'upsertOverride'])

        router.get('/subscriptions/companies/:companyId/effective', [SubscriptionAdminController, 'getEffectiveForCompany'])
        router.post('/subscriptions/companies/:companyId/change-plan', [SubscriptionAdminController, 'changePlan'])

        router.get('/subscriptions/invoices', [SubscriptionAdminController, 'listInvoices'])
        router.post('/subscriptions/invoices/generate', [SubscriptionAdminController, 'generateInvoices'])
        router.post('/subscriptions/invoices/validate', [SubscriptionAdminController, 'validateInvoices'])
        router.post('/subscriptions/invoices/:invoiceId/mark-paid', [SubscriptionAdminController, 'markInvoicePaid'])

        // Debug push notification
        router.post('/notifications/test-push', [AdminNotificationsController, 'sendTestPush'])
    }).prefix('/admin').use(({ auth, response }, next) => {
        if (!auth.user?.isAdmin) {
            return response.forbidden({ message: 'Admin access required' })
        }
        return next()
    })
})
    .prefix('/v1')
    .use(middleware.auth())
