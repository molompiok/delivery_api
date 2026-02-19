import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const PaymentPoliciesController = () => import('#controllers/payment_policies_controller')
const PricingFiltersController = () => import('#controllers/pricing_filters_controller')
const OrderPaymentsController = () => import('#controllers/order_payments_controller')
const SalaryPaymentsController = () => import('#controllers/salary_payments_controller')

router.group(() => {

    // ── Payment Policies ──
    router.get('/payment-policies', [PaymentPoliciesController, 'index'])
    router.get('/payment-policies/resolve', [PaymentPoliciesController, 'resolve'])
    router.get('/payment-policies/:id', [PaymentPoliciesController, 'show'])
    router.post('/payment-policies', [PaymentPoliciesController, 'store'])
    router.patch('/payment-policies/:id', [PaymentPoliciesController, 'update'])
    router.delete('/payment-policies/:id', [PaymentPoliciesController, 'destroy'])

    // ── Pricing Filters ──
    router.get('/pricing-filters', [PricingFiltersController, 'index'])
    router.get('/pricing-filters/resolve', [PricingFiltersController, 'resolve'])
    router.get('/pricing-filters/:id', [PricingFiltersController, 'show'])
    router.post('/pricing-filters', [PricingFiltersController, 'store'])
    router.patch('/pricing-filters/:id', [PricingFiltersController, 'update'])
    router.delete('/pricing-filters/:id', [PricingFiltersController, 'destroy'])
    router.post('/pricing-filters/price-matrix', [PricingFiltersController, 'priceMatrix'])

    // ── Order Payments ──
    router.get('/order-payments/:id', [OrderPaymentsController, 'show'])
    router.post('/order-payments/initiate', [OrderPaymentsController, 'initiate'])
    router.post('/order-payments/:id/authorize', [OrderPaymentsController, 'authorize'])
    router.post('/order-payments/:id/cod', [OrderPaymentsController, 'handleCod'])
    router.post('/order-payments/:id/refund', [OrderPaymentsController, 'refund'])

    // ── Salary Payments ──
    router.get('/salary-payments', [SalaryPaymentsController, 'index'])
    router.get('/salary-payments/:id', [SalaryPaymentsController, 'show'])
    router.post('/salary-payments', [SalaryPaymentsController, 'store'])
    router.post('/salary-payments/:id/adjust', [SalaryPaymentsController, 'adjust'])
    router.post('/salary-payments/:id/approve', [SalaryPaymentsController, 'approve'])
    router.post('/salary-payments/:id/pay', [SalaryPaymentsController, 'pay'])
    router.post('/salary-payments/batch-pay', [SalaryPaymentsController, 'batchPay'])

}).prefix('/v1').use(middleware.auth())

// ── Admin / Cron endpoints ──
router.group(() => {
    router.post('/settle-pending-cod', [OrderPaymentsController, 'settlePendingCod'])
}).prefix('/v1/admin').use(middleware.auth())
