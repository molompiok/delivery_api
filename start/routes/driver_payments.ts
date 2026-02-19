import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const DriverPaymentsController = () => import('#controllers/driver_payments_controller')

router.group(() => {

    router.group(() => {
        router.get('/wallets', [DriverPaymentsController, 'listWallets'])
        router.get('/transactions', [DriverPaymentsController, 'getTransactions'])
        router.post('/deposit', [DriverPaymentsController, 'deposit'])
        router.post('/payout', [DriverPaymentsController, 'payout'])
        router.post('/transfer', [DriverPaymentsController, 'transfer'])
        router.get('/stats', [DriverPaymentsController, 'stats'])
    }).prefix('/payments')

}).prefix('/v1/driver').use(middleware.auth())
