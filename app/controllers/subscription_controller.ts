import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import subscriptionService from '#services/subscription_service'

export default class SubscriptionController {
  async myEffective({ auth, response }: HttpContext) {
    try {
      const user = auth.user!
      const companyId = user.currentCompanyManaged || user.companyId
      if (!companyId) {
        return response.badRequest({ message: 'Company access required' })
      }
      const rates = await subscriptionService.resolveEffectiveRates(companyId)
      return response.ok(rates)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async myInvoices({ auth, request, response }: HttpContext) {
    try {
      const user = auth.user!
      const companyId = user.currentCompanyManaged || user.companyId
      if (!companyId) {
        return response.badRequest({ message: 'Company access required' })
      }
      const invoices = await subscriptionService.listInvoicesForCompany(
        companyId,
        request.only(['status', 'limit'])
      )
      return response.ok(invoices)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async myUsage({ auth, response }: HttpContext) {
    try {
      const user = auth.user!
      const companyId = user.currentCompanyManaged || user.companyId
      if (!companyId) {
        return response.badRequest({ message: 'Company access required' })
      }

      const now = DateTime.utc()
      const periodStart = now.startOf('month')
      const periodEndExclusive = periodStart.plus({ months: 1 })

      const usage = await subscriptionService.computeUsageForPeriod(
        companyId,
        periodStart,
        periodEndExclusive
      )

      return response.ok({
        month: periodStart.toFormat('yyyy-LL'),
        usage,
      })
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async changeMyPlan({ auth, request, response }: HttpContext) {
    try {
      const user = auth.user!
      const { activityType } = request.only(['activityType'])
      const company = await subscriptionService.changeMyCompanyPlan(user, activityType)
      return response.ok(company)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }
}
