import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const DriverController = () => import('#controllers/driver_controller')
const CompanyController = () => import('#controllers/company_controller')
const DebugController = () => import('#controllers/debug_controller')
const TestUserController = () => import('#controllers/test_user_controller')

router.group(() => {
    router.get('/debug/files', [DebugController, 'listFiles'])
    router.get('/debug/filedata', [DebugController, 'listFileData'])

    // Test Integrated File System
    router.get('/test-users/:id', [TestUserController, 'show'])
    router.post('/test-users', [TestUserController, 'store'])
    router.put('/test-users/:id', [TestUserController, 'update'])

    // Driver Routes
    router.post('/driver/register', [DriverController, 'registerAsDriver'])
    router.get('/driver/me', [DriverController, 'getMyDriverProfile'])
    router.put('/driver/me', [DriverController, 'updateDriverProfile'])
    router.get('/driver/documents', [DriverController, 'getMyDocuments'])
    router.get('/driver/companies', [DriverController, 'getMyCompanies'])
    router.get('/driver/invitations', [DriverController, 'getInvitations'])
    router.post('/driver/invitations/:invitationId/accept-access', [DriverController, 'acceptAccessRequest'])
    router.post('/driver/invitations/:invitationId/accept-fleet', [DriverController, 'acceptFleetInvitation'])
    router.post('/driver/invitations/:invitationId/reject', [DriverController, 'rejectRequest'])

    // Company Routes
    router.post('/company', [CompanyController, 'createCompany'])
    router.get('/company/me', [CompanyController, 'getMyCompany'])
    router.put('/company/me', [CompanyController, 'updateCompany'])
    router.post('/company/documents/upload', [CompanyController, 'uploadCompanyDoc'])
    router.post('/company/drivers/invite', [CompanyController, 'invite'])
    router.get('/company/drivers', [CompanyController, 'listDrivers'])
    router.get('/company/drivers/:driverId', [CompanyController, 'getDriver'])
    router.delete('/company/drivers/:driverId', [CompanyController, 'remove'])
    router.get('/company/requirements', [CompanyController, 'getRequirements'])
    router.post('/company/requirements', [CompanyController, 'updateRequirements'])
    router.post('/company/drivers/:driverId/sync-requirements', [CompanyController, 'syncRequirements'])

    // New Recruitment Routes
    router.post('/driver/documents/upload', [DriverController, 'uploadDoc'])
    router.post('/company/drivers/:driverId/required-docs', [CompanyController, 'setRequiredDocs'])
    router.post('/company/drivers/relation/:relationId/documents/upload', [CompanyController, 'uploadDoc'])
    router.post('/company/documents/:docId/validate', [CompanyController, 'validateDoc'])
    router.post('/company/drivers/:driverId/invite-to-fleet', [CompanyController, 'inviteToFleet'])
    router.post('/company/drivers/:driverId/force-mode', [CompanyController, 'forceWorkMode'])

    // Tracking
    router.post('/drivers/location', [DriverController, 'updateLocation'])
})
    .prefix('/v1')
    .use(middleware.auth())
