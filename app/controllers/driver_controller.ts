import type { HttpContext } from '@adonisjs/core/http'
import DriverService from '#services/driver_service'
import vine from '@vinejs/vine'
import { inject } from '@adonisjs/core'

@inject()
export default class DriverController {
    constructor(protected driverService: DriverService) { }

    static registerValidator = vine.compile(
        vine.object({
            vehicleType: vine.enum(['MOTORCYCLE', 'CAR', 'VAN', 'TRUCK']).optional(),
            vehiclePlate: vine.string().minLength(3).maxLength(15).optional(),
        })
    )

    static locationValidator = vine.compile(
        vine.object({
            lat: vine.number(),
            lng: vine.number(),
            heading: vine.number().optional(),
        })
    )

    public async registerAsDriver({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = await request.validateUsing(DriverController.registerValidator)
            const driverSetting = await this.driverService.register(user, data)
            return response.created({ message: 'Successfully registered as driver', driverSetting })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    public async getMyDriverProfile({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const driverSetting = await this.driverService.getProfile(user)
            return response.ok(driverSetting)
        } catch (error: any) {
            return response.notFound({ message: error.message })
        }
    }

    public async getMyDocuments({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const documents = await this.driverService.listDocuments(user)
            return response.ok({ documents: documents.map(doc => doc.serialize()) })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    public async updateDriverProfile({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = await request.validateUsing(DriverController.registerValidator)
            const driverSetting = await this.driverService.updateProfile(user, data)
            return response.ok({ message: 'Driver profile updated', driverSetting })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    public async getInvitations({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const invitations = await this.driverService.getInvitations(user)
            return response.ok(invitations)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    public async acceptAccessRequest({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const invitation = await this.driverService.acceptAccessRequest(user, params.invitationId)
            return response.ok({ message: 'Access granted successfully', invitation })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    public async acceptFleetInvitation({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const invitation = await this.driverService.acceptFleetInvitation(user, params.invitationId)
            return response.ok({ message: 'Joined company fleet successfully', invitation })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    public async rejectRequest({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            await this.driverService.rejectRequest(user, params.invitationId)
            return response.ok({ message: 'Request rejected' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    public async getMyCompanies({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const relationships = await this.driverService.getCompanies(user)
            return response.ok(relationships)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    public async updateLocation({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { lat, lng, heading } = await request.validateUsing(DriverController.locationValidator)
            await this.driverService.updateLocation(user.id, lat, lng, heading)
            return response.ok({ message: 'Location updated', timestamp: new Date().toISOString() })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    public async uploadDoc(ctx: HttpContext) {
        const { request, response, auth } = ctx
        try {
            const user = auth.user!
            const { docType } = request.body()
            if (!user.isDriver) return response.forbidden({ message: 'Only drivers can upload documents' })
            const result = await this.driverService.uploadDocument(ctx, user, docType)
            return response.created(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
