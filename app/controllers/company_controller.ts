import type { HttpContext } from '@adonisjs/core/http'
import CompanyService from '#services/company_service'
import ShiftService from '#services/shift_service'
import { inject } from '@adonisjs/core'

@inject()
export default class CompanyController {
    constructor(protected companyService: CompanyService) { }

    /**
     * Create a new company
     */
    public async createCompany({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.only(['name', 'registreCommerce', 'logo', 'description'])
            const company = await this.companyService.create(user, data)
            return response.created(company)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get the authenticated user's company
     */
    public async getMyCompany({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const company = await this.companyService.getCompanyDetails(user)
            return response.ok(company)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Update the authenticated user's company
     */
    public async updateCompany({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = request.only(['name', 'registreCommerce', 'logo', 'description'])
            const company = await this.companyService.update(user, data)
            return response.ok(company)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List all drivers (with filters)
     */
    public async listDrivers({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const filters = request.qs()
            const drivers = await this.companyService.listDrivers(user, filters)
            return response.ok(drivers)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get driver details
     */
    public async getDriver({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const driver = await this.companyService.getDriverDetails(user, params.driverId)
            return response.ok(driver)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Invite a new driver
     */
    public async invite({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { phone } = request.only(['phone'])
            const invitation = await this.companyService.inviteDriver(user, phone)
            return response.ok({ message: 'Driver invited successfully', invitation })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Remove a driver from company
     */
    public async remove({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            await this.companyService.removeDriver(user, params.driverId)
            return response.ok({ message: 'Driver removed successfully' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Set required documents for a driver
     */
    public async setRequiredDocs({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { docTypeIds } = request.only(['docTypeIds'])
            const relation = await this.companyService.setRequiredDocs(user, params.driverId, docTypeIds)
            return response.ok({ message: 'Required documents set successfully', relation })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Validate an uploaded document
     */
    public async validateDoc({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { status, comment } = request.only(['status', 'comment'])
            const file = await this.companyService.validateDocument(user, params.docId, status, comment)
            return response.ok({ message: 'Document validation updated', file })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Final invitation to fleet
     */
    public async inviteToFleet({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const relation = await this.companyService.inviteToFleet(user, params.driverId)
            return response.ok({ message: 'Fleet invitation sent successfully', relation })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Force shift mode for a driver
     */
    async forceWorkMode({ auth, params, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { mode } = request.only(['mode'])
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            await ShiftService.forceMode(params.driverId, mode, activeCompanyId!)
            return response.ok({ message: 'Mode forced successfully' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Upload a document for a driver (ETP Doc)
     */
    async uploadDoc(ctx: HttpContext) {
        const { params, request, response, auth } = ctx
        try {
            const user = auth.user!
            const { docType } = request.body()
            const result = await this.companyService.uploadDocument(ctx, user, params.relationId, docType)
            return response.created(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Upload a document for the company itself
     */
    async uploadCompanyDoc(ctx: HttpContext) {
        const { request, response, auth } = ctx
        try {
            const user = auth.user!
            const { docType } = request.body()
            const result = await this.companyService.uploadCompanyDocument(ctx, user, docType)
            return response.created(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Sync driver document requirements with company standards
     */
    async syncRequirements({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            await this.companyService.syncRequiredDocsFromMetadata(user, params.driverId)
            return response.ok({ message: 'Driver requirements synced with company standards' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get Company Document Requirements
     */
    async getRequirements({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const requirements = await this.companyService.getDocumentRequirements(user)
            return response.ok(requirements)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Update Company Document Requirements
     */
    async updateRequirements({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { requirements } = request.only(['requirements'])
            const updated = await this.companyService.updateDocumentRequirements(user, requirements)
            return response.ok(updated)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
