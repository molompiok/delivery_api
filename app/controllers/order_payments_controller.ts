import type { HttpContext } from '@adonisjs/core/http'
import orderPaymentService from '#services/order_payment_service'

export default class OrderPaymentsController {

    /**
     * Show an order payment with stop payments and COD details
     */
    public async show({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const payment = await orderPaymentService.findById(params.id, user)
            return response.ok(payment)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Initiate a payment for an order
     */
    public async initiate({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.body()
            const payment = await orderPaymentService.initiate(user, data)
            return response.created(payment)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Authorize a payment (create Wave payment intent → returns checkout URL)
     */
    public async authorize({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.body()
            const result = await orderPaymentService.authorize(params.id, user, data)
            return response.ok(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Handle COD collection by driver
     */
    public async handleCod({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.body()
            const cod = await orderPaymentService.handleCod(params.id, user, data)
            return response.ok(cod)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Refund a payment
     */
    public async refund({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.body()
            await orderPaymentService.refund(params.id, user, data)
            return response.ok({ message: 'Payment refunded' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Settle all pending/deferred COD collections (admin/cron endpoint)
     */
    public async settlePendingCod({ response }: HttpContext) {
        try {
            const result = await orderPaymentService.settlePendingCod()
            return response.ok(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
