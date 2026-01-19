import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import Company from '#models/company'
import CompanyService from '#services/company_service'
import ShiftService from '#services/shift_service'

const createCompanyValidator = vine.compile(
    vine.object({
        name: vine.string().trim().minLength(2).maxLength(255),
        registreCommerce: vine.string().trim().optional(),
        logo: vine.string().trim().optional(),
        description: vine.string().trim().optional(),
    })
)

const inviteDriverValidator = vine.compile(
    vine.object({
        phone: vine.string().trim().regex(/^\+[1-9]\d{7,14}$/),
    })
)

const forceModeValidator = vine.compile(
    vine.object({
        mode: vine.enum(['IDEP', 'ETP']),
    })
)

export default class CompanyController {
    /**
     * Create a company for the authenticated user
     */
    public async createCompany({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = await request.validateUsing(createCompanyValidator)
            const company = await CompanyService.create(user, data)

            return response.created({
                message: 'Company created successfully',
                company,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get company owned by user
     */
    public async getMyCompany({ auth, response }: HttpContext) {
        const user = auth.user!
        if (!user.companyId) {
            return response.notFound({ message: 'User does not own a company' })
        }

        const company = await Company.findOrFail(user.companyId)
        return response.ok(company)
    }

    /**
     * Update company information
     */
    public async updateCompany({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = await request.validateUsing(createCompanyValidator)
            const company = await CompanyService.update(user, data)

            return response.ok({
                message: 'Company updated successfully',
                company,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Invite a driver to join the company
     */
    public async inviteDriver({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { phone } = await request.validateUsing(inviteDriverValidator)
            const invitation = await CompanyService.inviteDriver(user, phone)

            return response.ok({
                message: 'Driver invited successfully',
                invitation,
            })
        } catch (error: any) {
            if (error.code === 'E_VALIDATION_ERROR') {
                return response.unprocessableEntity(error.messages)
            }
            if (error.code === 'E_ROW_NOT_FOUND' || error.message.includes('not found')) {
                return response.notFound({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List all drivers in the company
     */
    public async listCompanyDrivers({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const filters = request.only(['status', 'name', 'email', 'phone'])
            const drivers = await CompanyService.listDrivers(user, filters)
            return response.ok(drivers)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get specific driver details
     */
    public async getDriverDetails({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const details = await CompanyService.getDriverDetails(user, params.driverId)
            return response.ok(details)
        } catch (error: any) {
            if (error.code === 'E_ROW_NOT_FOUND') {
                return response.notFound({ message: 'Driver not found in company' })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Remove a driver from the company
     */
    public async removeDriver({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            await CompanyService.removeDriver(user, params.driverId)

            return response.ok({
                message: 'Driver removed from company',
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Force a driver's work mode (IDEP or ETP)
     */
    public async forceWorkMode({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { mode } = await request.validateUsing(forceModeValidator)

            // Security: ShiftService handles company context, but we ensure company manager
            if (!user.companyId || !user.currentCompanyManaged) {
                return response.forbidden({ message: 'Only company managers can force work modes' })
            }

            await ShiftService.forceMode(params.driverId, mode, user.companyId)

            return response.ok({
                message: `Driver mode forced to ${mode} successfully`,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Step 3: Set required documents for a driver
     */
    public async setRequiredDocs({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { docTypeIds } = request.only(['docTypeIds'])
            const relation = await CompanyService.setRequiredDocs(user, params.driverId, docTypeIds)

            return response.ok({
                message: 'Required documents set successfully',
                relation,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Step 6: Validate an individual document
     */
    public async validateDocument({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { status, comment } = request.only(['status', 'comment'])
            const file = await CompanyService.validateDocument(user, params.fileId, status, comment)

            return response.ok({
                message: 'Document validation updated',
                file,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Step 7: Final invitation to fleet
     */
    public async inviteToFleet({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const relation = await CompanyService.inviteToFleet(user, params.driverId)

            return response.ok({
                message: 'Fleet invitation sent successfully',
                relation,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
