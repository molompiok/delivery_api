import type { HttpContext } from '@adonisjs/core/http'
import VerificationService from '#services/verification_service'

export default class VerificationController {
    /**
     * List pending driver verifications
     */
    async pendingDrivers({ request, response }: HttpContext) {
        try {
            const page = request.input('page', 1)
            const limit = request.input('limit', 20)
            const status = request.input('status', 'all')
            const drivers = await VerificationService.listPendingDrivers(page, limit, status)
            return response.ok(drivers)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List pending vehicle verifications
     */
    async pendingVehicles({ request, response }: HttpContext) {
        try {
            const page = request.input('page', 1)
            const limit = request.input('limit', 20)
            const vehicles = await VerificationService.listPendingVehicles(page, limit)
            return response.ok(vehicles)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get full driver detailama
     */
    async getDriverDetail({ params, response }: HttpContext) {
        try {
            const result = await VerificationService.getDriverDetail(params.driverId)
            return response.ok(result)
        } catch (error: any) {
            if (error.message.includes('not found')) {
                return response.notFound({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Validate or reject a driver document
     */
    async validateDocument({ params, request, response, auth }: HttpContext) {
        try {
            const { status, comment } = request.only(['status', 'comment'])
            const doc = await VerificationService.validateDocument(
                params.docId,
                status,
                comment,
                auth.user
            )

            return response.ok({
                message: `Document ${status.toLowerCase()}`,
                document: doc
            })
        } catch (error: any) {
            if (error.message.includes('not found')) {
                return response.notFound({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Verify a driver
     */
    async verifyDriver({ params, request, response }: HttpContext) {
        try {
            const { status } = request.only(['status'])
            const driverSetting = await VerificationService.verifyDriver(params.driverId, status)

            return response.ok({
                message: `Driver status updated to ${status}`,
                driverSetting
            })
        } catch (error: any) {
            if (error.message.includes('not found')) {
                return response.notFound({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List all companies (Admin)
     */
    async listCompanies({ request, response }: HttpContext) {
        try {
            const page = request.input('page', 1)
            const limit = request.input('limit', 20)
            const status = request.input('status', 'all')
            const companies = await VerificationService.listCompanies(page, limit, status)
            return response.ok(companies)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get company detail (Admin)
     */
    async getCompanyDetail({ params, response }: HttpContext) {
        try {
            const result = await VerificationService.getCompanyDetail(params.companyId)
            return response.ok(result)
        } catch (error: any) {
            if (error.message.includes('not found')) {
                return response.notFound({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List pending company verifications
     */
    async pendingCompanies({ request, response }: HttpContext) {
        return this.listCompanies({ request, response } as any)
    }

    /**
     * Verify a company
     */
    async verifyCompany({ params, request, response }: HttpContext) {
        try {
            const { status } = request.only(['status'])
            const company = await VerificationService.verifyCompany(params.companyId, status)

            return response.ok({
                message: `Company status updated to ${status}`,
                company
            })
        } catch (error: any) {
            if (error.message.includes('not found')) {
                return response.notFound({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Impersonate a company (Admin)
     */
    async impersonate({ auth, params, response }: HttpContext) {
        try {
            const admin = auth.user!
            const result = await VerificationService.impersonateCompany(admin, params.companyId)
            return response.ok(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
