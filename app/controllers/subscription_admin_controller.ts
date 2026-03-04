import type { HttpContext } from '@adonisjs/core/http'
import subscriptionService from '#services/subscription_service'

export default class SubscriptionAdminController {
  async listPlans({ response }: HttpContext) {
    try {
      const plans = await subscriptionService.listPlans()
      return response.ok(plans)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async upsertPlan({ auth, params, request, response }: HttpContext) {
    try {
      const admin = auth.user!
      const data = {
        ...request.only([
          'baseAmount',
          'commandeCommissionPercent',
          'ticketFeePercent',
          'taxPercent',
          'currency',
          'allowNewCompanies',
          'isActive',
          'metadata',
        ]),
        activityType: params.activityType,
      }
      const plan = await subscriptionService.upsertPlan(admin, data)
      return response.ok(plan)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async listOverrides({ auth, request, response }: HttpContext) {
    try {
      const admin = auth.user!
      const companyId = request.input('companyId')
      const overrides = await subscriptionService.listCompanyOverrides(admin, companyId)
      return response.ok(overrides)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async upsertOverride({ auth, params, request, response }: HttpContext) {
    try {
      const admin = auth.user!
      const override = await subscriptionService.upsertCompanyOverride(
        admin,
        params.companyId,
        request.only([
          'baseAmount',
          'commandeCommissionPercent',
          'ticketFeePercent',
          'taxPercent',
          'currency',
          'isActive',
          'metadata',
        ])
      )
      return response.ok(override)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async getEffectiveForCompany({ params, response }: HttpContext) {
    try {
      const rates = await subscriptionService.resolveEffectiveRates(params.companyId)
      return response.ok(rates)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async generateInvoices({ auth, request, response }: HttpContext) {
    try {
      const admin = auth.user!
      const month = request.input('month')
      const result = await subscriptionService.generateMonthlyInvoices({ month }, admin.id)
      return response.ok(result)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async validateInvoices({ response }: HttpContext) {
    try {
      const result = await subscriptionService.markOverdueInvoices()
      return response.ok(result)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async listInvoices({ auth, request, response }: HttpContext) {
    try {
      const admin = auth.user!
      const invoices = await subscriptionService.listInvoices(
        admin,
        request.only(['companyId', 'status', 'month', 'limit'])
      )
      return response.ok(invoices)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async markInvoicePaid({ auth, params, request, response }: HttpContext) {
    try {
      const admin = auth.user!
      const invoice = await subscriptionService.markInvoicePaid(
        admin,
        params.invoiceId,
        request.only(['paymentReference', 'metadata'])
      )
      return response.ok(invoice)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async changePlan({ auth, params, request, response }: HttpContext) {
    try {
      const admin = auth.user!
      const { activityType } = request.only(['activityType'])
      const company = await subscriptionService.changeCompanyPlan(
        admin,
        params.companyId,
        activityType
      )
      return response.ok(company)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }
}
