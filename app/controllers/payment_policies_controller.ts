import type { HttpContext } from '@adonisjs/core/http'
import paymentPolicyService from '#services/payment_policy_service'

export default class PaymentPoliciesController {

    /**
     * List payment policies for the authenticated user's company
     */
    public async index({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const policies = await paymentPolicyService.listForCompany(user)
            return response.ok(policies)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Show a single payment policy
     */
    public async show({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const policy = await paymentPolicyService.findById(params.id, user)
            return response.ok(policy)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Resolve the applicable payment policy (driver → company → default chain)
     */
    public async resolve({ request, response }: HttpContext) {
        try {
            const { driverId, companyId, domain } = request.qs()
            const policy = await paymentPolicyService.resolve(driverId, companyId, domain)
            return response.ok(policy)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Create a new payment policy
     */
    public async store({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.body()
            const policy = await paymentPolicyService.create(user, data)
            return response.created(policy)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Update a payment policy
     */
    public async update({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.body()
            const policy = await paymentPolicyService.update(params.id, user, data)
            return response.ok(policy)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Delete a payment policy
     */
    public async destroy({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            await paymentPolicyService.delete(params.id, user)
            return response.ok({ message: 'Policy deleted' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
