import type { HttpContext } from '@adonisjs/core/http'
import IdepVehicleService from '#services/idep_vehicle_service'
import VehicleService from '#services/vehicle_service'
import Vehicle from '#models/vehicle'
import vine from '@vinejs/vine'
import { inject } from '@adonisjs/core'

@inject()
export default class IdepVehicleController {
    constructor(
        protected idepVehicleService: IdepVehicleService,
        protected vehicleService: VehicleService
    ) { }

    /**
     * Validator for IDEP vehicle creation
     */
    static createValidator = vine.compile(
        vine.object({
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
        })
    )

    /**
     * Register a new vehicle (IDEP flow)
     */
    async store({ request, response, auth }: HttpContext) {
        const user = auth.user!
        const data = await request.validateUsing(IdepVehicleController.createValidator)

        try {
            const vehicle = await this.idepVehicleService.createVehicle(user, data)
            return response.created(vehicle)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List my vehicles (IDEP flow)
     */
    async index({ response, auth }: HttpContext) {
        const user = auth.user!
        const vehicles = await this.idepVehicleService.listVehicles(user)
        return response.ok(vehicles)
    }

    /**
     * Update details of one of my vehicles
     */
    async update({ params, request, response, auth }: HttpContext) {
        const user = auth.user!
        const vehicle = await Vehicle.query()
            .where('id', params.id)
            .where('ownerType', 'User')
            .where('ownerId', user.id)
            .first()

        if (!vehicle) {
            return response.notFound({ message: 'Vehicle not found or not owned by you' })
        }

        const data = await request.validateUsing(IdepVehicleController.createValidator)
        const updated = await this.vehicleService.saveVehicle(user, {
            ...data,
            id: vehicle.id,
            ownerType: 'User',
            ownerId: user.id
        } as any)

        return response.ok(updated)
    }

    /**
     * Get details of one of my vehicles
     */
    async show({ params, response, auth }: HttpContext) {
        const user = auth.user!
        try {
            const vehicle = await this.idepVehicleService.getVehicle(user, params.id)
            return response.ok(vehicle)
        } catch (error: any) {
            return response.notFound({ message: 'Vehicle not found or not owned by you' })
        }
    }

    /**
     * Upload a document for an IDEP vehicle
     * Reuses the generic VehicleService.uploadDocument logic but within IDEP context
     */
    async uploadDoc(ctx: HttpContext) {
        const { params, request, response, auth } = ctx
        const user = auth.user!

        const vehicle = await Vehicle.query()
            .where('id', params.id)
            .where('ownerType', 'User')
            .where('ownerId', user.id)
            .first()

        if (!vehicle) {
            return response.notFound({ message: 'Vehicle not found' })
        }

        const { docType, expiryDate } = request.body()

        try {
            const result = await this.vehicleService.uploadDocument(ctx, vehicle.id, docType, user, expiryDate)
            return response.ok(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
