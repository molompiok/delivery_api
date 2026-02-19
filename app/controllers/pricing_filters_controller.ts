import type { HttpContext } from '@adonisjs/core/http'
import pricingFilterService from '#services/pricing_filter_service'

export default class PricingFiltersController {

    /**
     * List pricing filters for the authenticated user's company
     */
    public async index({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const filters = await pricingFilterService.listForCompany(user)
            return response.ok(filters)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Show a single pricing filter
     */
    public async show({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const filter = await pricingFilterService.findById(params.id, user)
            return response.ok(filter)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Resolve the applicable pricing filter (driver → company → default chain)
     */
    public async resolve({ request, response }: HttpContext) {
        try {
            const { driverId, companyId, domain } = request.qs()
            const filter = await pricingFilterService.resolve(driverId, companyId, domain)
            return response.ok(filter)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Create a new pricing filter
     */
    public async store({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.body()
            const filter = await pricingFilterService.create(user, data)
            return response.created(filter)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Update a pricing filter
     */
    public async update({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.body()
            const filter = await pricingFilterService.update(params.id, user, data)
            return response.ok(filter)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Delete a pricing filter
     */
    public async destroy({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            await pricingFilterService.delete(params.id, user)
            return response.ok({ message: 'Filter deleted' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Build a price matrix comparing multiple filters
     */
    public async priceMatrix({ request, response }: HttpContext) {
        try {
            const data = request.body()
            const matrix = await pricingFilterService.buildPriceMatrix(data)
            return response.ok(matrix)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
