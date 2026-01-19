import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const DriverController = () => import('#controllers/driver_controller')
const CompanyController = () => import('#controllers/company_controller')
const FileController = () => import('#controllers/file_controller')

router.group(() => {
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
    router.get('/company/files', [FileController, 'listMyCompanyFiles'])
    router.post('/company/drivers/invite', [CompanyController, 'inviteDriver'])
    router.get('/company/drivers', [CompanyController, 'listCompanyDrivers'])
    router.get('/company/drivers/:driverId', [CompanyController, 'getDriverDetails'])
    router.delete('/company/drivers/:driverId', [CompanyController, 'removeDriver'])

    // New Recruitment Routes
    router.post('/company/drivers/:driverId/required-docs', [CompanyController, 'setRequiredDocs'])
    router.post('/company/documents/:fileId/validate', [CompanyController, 'validateDocument'])
    router.post('/company/drivers/:driverId/invite-to-fleet', [CompanyController, 'inviteToFleet'])
    router.post('/company/drivers/:driverId/force-mode', [CompanyController, 'forceWorkMode'])

    // Tracking
    router.post('/driver/location', [DriverController, 'updateLocation'])
})
    .prefix('/v1')
    .use(middleware.auth())
