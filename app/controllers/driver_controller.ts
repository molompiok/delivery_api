import type { HttpContext } from '@adonisjs/core/http'
import DriverService from '#services/driver_service'
import TrackingService from '#services/tracking_service'
import vine from '@vinejs/vine'
import Document from '#models/document'

export default class DriverController {
    /**
     * Validator for driver registration/update
     */
    static registerValidator = vine.compile(
        vine.object({
            vehicleType: vine.enum(['MOTORCYCLE', 'CAR', 'VAN', 'TRUCK']),
            vehiclePlate: vine.string().minLength(3).maxLength(15),
        })
    )

    static locationValidator = vine.compile(
        vine.object({
            lat: vine.number(),
            lng: vine.number(),
            heading: vine.number().optional(),
        })
    )

    /**
     * Register user as driver
     */
    public async registerAsDriver({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = await request.validateUsing(DriverController.registerValidator)
            const driverSetting = await DriverService.register(user, data)

            return response.created({
                message: 'Successfully registered as driver',
                driverSetting,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get current user's driver profile
     */
    public async getMyDriverProfile({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const driverSetting = await DriverService.getProfile(user)
            return response.ok(driverSetting)
        } catch (error: any) {
            return response.notFound({ message: error.message })
        }
    }

    /**
     * Get my documents (driver's own documents)
     */
    public async getMyDocuments({ auth, response }: HttpContext) {
        try {
            const user = auth.user!

            if (!user.isDriver) {
                return response.badRequest({ message: 'User is not registered as a driver' })
            }

            const documents = await Document.query()
                .where('tableName', 'User')
                .where('tableId', user.id)
                .where('isDeleted', false)
                .preload('file')
                .orderBy('createdAt', 'desc')

            return response.ok({
                documents: documents.map(doc => ({
                    id: doc.id,
                    documentType: doc.documentType,
                    status: doc.status,
                    fileId: doc.fileId,
                    file: doc.file ? {
                        id: doc.file.id,
                        name: doc.file.name,
                        mimeType: doc.file.mimeType,
                        size: doc.file.size,
                    } : null,
                    validationComment: doc.validationComment,
                    expireAt: doc.expireAt,
                    createdAt: doc.createdAt,
                    updatedAt: doc.updatedAt,
                }))
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Update driver profile
     */
    public async updateDriverProfile({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const data = await request.validateUsing(DriverController.registerValidator)
            const driverSetting = await DriverService.updateProfile(user, data)

            return response.ok({
                message: 'Driver profile updated',
                driverSetting,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get pending company invitations
     */
    public async getInvitations({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const invitations = await DriverService.getInvitations(user)
            return response.ok(invitations)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Step 4: Accept document access request
     */
    public async acceptAccessRequest({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const invitation = await DriverService.acceptAccessRequest(user, params.invitationId)

            return response.ok({
                message: 'Access granted successfully',
                invitation,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Step 7: Accept final fleet invitation
     */
    public async acceptFleetInvitation({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            const invitation = await DriverService.acceptFleetInvitation(user, params.invitationId)

            return response.ok({
                message: 'Joined company fleet successfully',
                invitation,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Reject any request (access or fleet)
     */
    public async rejectRequest({ auth, params, response }: HttpContext) {
        try {
            const user = auth.user!
            await DriverService.rejectRequest(user, params.invitationId)

            return response.ok({
                message: 'Request rejected',
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get companies the driver is associated with
     */
    public async getMyCompanies({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const relationships = await DriverService.getCompanies(user)
            return response.ok(relationships)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Update current location (GPS Ping)
     */
    public async updateLocation({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { lat, lng, heading } = await request.validateUsing(DriverController.locationValidator)

            await TrackingService.track(user.id, lat, lng, heading)

            return response.ok({
                message: 'Location updated',
                timestamp: new Date().toISOString()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
