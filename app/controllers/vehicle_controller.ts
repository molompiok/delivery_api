import type { HttpContext } from '@adonisjs/core/http'
import VehicleService from '#services/vehicle_service'
import { VehicleOwnerType } from '#models/vehicle'
import { inject } from '@adonisjs/core'
import vine from '@vinejs/vine'

@inject()
export default class VehicleController {
    constructor(protected vehicleService: VehicleService) { }

    static vehicleValidator = vine.compile(
        vine.object({
            ownerType: vine.enum(['User', 'Company']),
            ownerId: vine.string(),
            type: vine.enum(['MOTO', 'CAR_SEDAN', 'VAN', 'TRUCK', 'BICYCLE']),
            brand: vine.string().optional(),
            model: vine.string().optional(),
            plate: vine.string(),
            year: vine.number().optional(),
            color: vine.string().optional(),
            energy: vine.string().optional(),
            specs: vine.object({
                maxWeight: vine.number().optional(),
                cargoVolume: vine.number().optional(),
                height: vine.number().optional(),
                length: vine.number().optional(),
                width: vine.number().optional(),
            }).optional(),
            isActive: vine.boolean().optional(),
        })
    )

    async index({ request, response, auth }: HttpContext) {
        try {
            const { ownerType, ownerId } = request.qs()
            const user = auth.user!
            if (!ownerType || !ownerId) return response.badRequest({ message: 'ownerType and ownerId are required' })

            const vehicles = await this.vehicleService.listVehicles(user, ownerType as VehicleOwnerType, ownerId)
            return response.ok(vehicles)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async show({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const vehicle = await this.vehicleService.getVehicleDetails(user, params.id)
            return response.ok(vehicle)
        } catch (error: any) {
            return response.notFound({ message: error.message })
        }
    }

    async store({ request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const data = await request.validateUsing(VehicleController.vehicleValidator)
            const vehicle = await this.vehicleService.saveVehicle(user, data)
            return response.created(vehicle)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async update({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const data = await request.validateUsing(VehicleController.vehicleValidator)
            const updated = await this.vehicleService.saveVehicle(user, { ...data, id: params.id })
            return response.ok(updated)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async destroy({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            await this.vehicleService.deleteVehicle(user, params.id)
            return response.noContent()
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async assignDriver({ params, request, response, auth }: HttpContext) {
        try {
            const { driverId } = request.only(['driverId'])
            const user = auth.user!
            const vehicle = await this.vehicleService.assignDriver(params.id, driverId || null, user)
            return response.ok(vehicle)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async setActiveVehicleETP({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const { driverId } = request.only(['driverId'])
            const cds = await this.vehicleService.setActiveVehicleETP(user, params.id, driverId)
            return response.ok({ message: 'Active vehicle set successfully', companyDriverSetting: cds })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async clearActiveVehicleETP({ request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const { driverId } = request.only(['driverId'])
            await this.vehicleService.clearActiveVehicleETP(user, driverId)
            return response.ok({ message: 'Active vehicle cleared' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async setActiveVehicleIDEP({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const ds = await this.vehicleService.setActiveVehicleIDEP(user, params.id)
            return response.ok({ message: 'Active IDEP vehicle set successfully', driverSetting: ds })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async clearActiveVehicleIDEP({ response, auth }: HttpContext) {
        try {
            const user = auth.user!
            await this.vehicleService.clearActiveVehicleIDEP(user)
            return response.ok({ message: 'Active IDEP vehicle cleared' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async getActiveDriver({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const driver = await this.vehicleService.getActiveDriver(user, params.id)
            return response.ok({ activeDriver: driver })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async uploadDoc(ctx: HttpContext) {
        const { params, request, response, auth } = ctx
        try {
            const { docType, expiryDate } = request.only(['docType', 'expiryDate'])
            const user = auth.user!
            const result = await this.vehicleService.uploadDocument(ctx, params.id, docType, user, expiryDate)
            return response.created(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async listOrders({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const orders = await this.vehicleService.listVehicleOrders(user, params.id)
            return response.ok(orders)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
