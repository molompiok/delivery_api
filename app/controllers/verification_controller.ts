import type { HttpContext } from '@adonisjs/core/http'
import VerificationService from '#services/verification_service'

export default class VerificationController {
    /**
     * List pending driver verifications
     */
    async pendingDrivers({ response }: HttpContext) {
        try {
            const drivers = await VerificationService.listPendingDrivers()
            return response.ok(drivers)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get driver documents for admin review
     */
    async getDriverDocuments({ params, response }: HttpContext) {
        try {
            const result = await VerificationService.getDriverDocuments(params.driverId)
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
     * List pending company verifications
     */
    async pendingCompanies({ response }: HttpContext) {
        try {
            const companies = await VerificationService.listPendingCompanies()
            return response.ok(companies)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
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
}
