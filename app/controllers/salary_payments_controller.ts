import type { HttpContext } from '@adonisjs/core/http'
import salaryPaymentService from '#services/salary_payment_service'

export default class SalaryPaymentsController {

    /**
     * List salary payments for the authenticated user's company
     */
    public async index({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { status } = request.qs()
            const salaries = await salaryPaymentService.listForCompany(user, status)
            return response.ok(salaries)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Show a single salary payment
     */
    public async show({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const salary = await salaryPaymentService.findById(params.id, user)
            return response.ok(salary)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Create a new salary payment
     */
    public async store({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.body()
            const salary = await salaryPaymentService.create(user, data)
            return response.created(salary)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Adjust a salary (bonus or deduction)
     */
    public async adjust({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.body()
            const salary = await salaryPaymentService.adjust(params.id, user, data)
            return response.ok(salary)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Approve a salary
     */
    public async approve({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const salary = await salaryPaymentService.approve(params.id, user)
            return response.ok(salary)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Pay a single salary
     */
    public async pay({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const salary = await salaryPaymentService.pay(params.id, user)
            return response.ok(salary)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Batch pay all approved salaries (optionally filtered by IDs)
     */
    public async batchPay({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { ids } = request.body()
            const result = await salaryPaymentService.batchPay(user, ids)
            return response.ok(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
