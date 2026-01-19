import type { HttpContext } from '@adonisjs/core/http'
import VehicleService from '#services/vehicle_service'
import Vehicle, { VehicleOwnerType } from '#models/vehicle'
import User from '#models/user'
import DriverSetting from '#models/driver_setting'
import CompanyDriverSetting from '#models/company_driver_setting'
import vine from '@vinejs/vine'

export default class VehicleController {
    /**
     * Validator for vehicle creation/update
     */
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

    private async canEditVehicle(user: User, ownerType: string, ownerId: string): Promise<boolean> {
        if (user.isAdmin) return true;

        // 1. My own vehicle
        if (ownerType === 'User' && ownerId === user.id) return true;

        // 2. Company vehicle
        if (ownerType === 'Company') {
            if (user.companyId === ownerId && user.currentCompanyManaged) return true;
        }

        return false;
    }

    /**
     * Get context from auth (similar to zones_controller)
     */
    private async getContext(auth: any) {
        const user = auth.user!
        let companyId = user.currentCompanyManaged || user.companyId
        return { user, companyId }
    }

    /**
     * List vehicles for an owner
     */
    async index({ request, response, auth }: HttpContext) {
        const { ownerType, ownerId } = request.qs()
        const user = auth.user!

        if (!ownerType || !ownerId) {
            return response.badRequest({ message: 'ownerType and ownerId are required' })
        }

        // Security check
        if (!(await this.canEditVehicle(user, ownerType, ownerId))) {
            return response.forbidden({ message: 'Permission denied to view these vehicles' })
        }

        const vehicles = await VehicleService.listVehicles(ownerType as VehicleOwnerType, ownerId)
        return response.ok(vehicles)
    }

    /**
     * Get a single vehicle
     */
    async show({ params, response, auth }: HttpContext) {
        const vehicle = await Vehicle.find(params.id)
        if (!vehicle) {
            return response.notFound({ message: 'Vehicle not found' })
        }

        const user = auth.user!
        if (!(await this.canEditVehicle(user, vehicle.ownerType, vehicle.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        await vehicle.load('assignedDriver')
        await vehicle.load('files')
        return response.ok(vehicle)
    }

    /**
     * Create a new vehicle
     */
    async store({ request, response, auth }: HttpContext) {
        const data = await request.validateUsing(VehicleController.vehicleValidator)
        const user = auth.user!

        // Security check
        if (!(await this.canEditVehicle(user, data.ownerType, data.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        const vehicle = await VehicleService.saveVehicle(data as any)
        return response.created(vehicle)
    }

    /**
     * Update a vehicle
     */
    async update({ params, request, response, auth }: HttpContext) {
        const vehicle = await Vehicle.find(params.id)
        if (!vehicle) {
            return response.notFound({ message: 'Vehicle not found' })
        }

        const user = auth.user!
        if (!(await this.canEditVehicle(user, vehicle.ownerType, vehicle.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        const data = await request.validateUsing(VehicleController.vehicleValidator)

        const updated = await VehicleService.saveVehicle({ ...data, id: vehicle.id } as any)
        return response.ok(updated)
    }

    /**
     * Delete a vehicle
     */
    async destroy({ params, response, auth }: HttpContext) {
        const vehicle = await Vehicle.find(params.id)
        if (!vehicle) {
            return response.notFound({ message: 'Vehicle not found' })
        }

        const user = auth.user!
        if (!(await this.canEditVehicle(user, vehicle.ownerType, vehicle.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        await vehicle.delete()
        return response.noContent()
    }

    /**
     * Assign a driver to the vehicle (Company only) - Legacy, prefer setActiveVehicleETP
     */
    async assignDriver({ params, request, response, auth }: HttpContext) {
        const { driverId } = request.body()
        const user = auth.user!

        try {
            const vehicle = await VehicleService.assignDriver(params.id, driverId || null, user)
            return response.ok(vehicle)
        } catch (error) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Set active vehicle for a driver in ETP mode (Manager action)
     * Updates CompanyDriverSetting.activeVehicleId
     */
    async setActiveVehicleETP({ params, request, response, auth }: HttpContext) {
        const { companyId } = await this.getContext(auth)
        const { driverId } = request.only(['driverId'])

        if (!companyId) {
            return response.badRequest({ message: 'Company context required' })
        }

        const vehicle = await Vehicle.query()
            .where('id', params.id)
            .where('ownerId', companyId)
            .where('ownerType', 'Company')
            .first()

        if (!vehicle) return response.notFound({ message: 'Company Vehicle not found' })

        // Verify driver belongs to this company (any status)
        const cds = await CompanyDriverSetting.query()
            .where('companyId', companyId)
            .where('driverId', driverId)
            .first()

        if (!cds) {
            return response.forbidden({ message: 'Driver does not belong to your company' })
        }

        // Check if vehicle is already assigned to another driver
        const existingAssignment = await CompanyDriverSetting.query()
            .where('companyId', companyId)
            .where('activeVehicleId', vehicle.id)
            .whereNot('driverId', driverId)
            .first()

        if (existingAssignment) {
            return response.conflict({
                message: 'Vehicle is already assigned to another driver',
                assignedTo: existingAssignment.driverId
            })
        }

        // Set active vehicle
        cds.activeVehicleId = vehicle.id
        await cds.save()

        // Also update legacy assignedDriverId on vehicle for compatibility
        vehicle.assignedDriverId = driverId
        await vehicle.save()

        return response.ok({
            message: 'Active vehicle set successfully',
            companyDriverSetting: cds
        })
    }

    /**
     * Clear active vehicle for a driver in ETP mode
     */
    async clearActiveVehicleETP({ request, response, auth }: HttpContext) {
        const { companyId } = await this.getContext(auth)
        const { driverId } = request.only(['driverId'])

        if (!companyId) {
            return response.badRequest({ message: 'Company context required' })
        }

        const cds = await CompanyDriverSetting.query()
            .where('companyId', companyId)
            .where('driverId', driverId)
            .first()

        if (!cds) {
            return response.forbidden({ message: 'Driver does not belong to your company' })
        }

        // Clear legacy assignedDriverId if it was this driver
        if (cds.activeVehicleId) {
            const vehicle = await Vehicle.find(cds.activeVehicleId)
            if (vehicle && vehicle.assignedDriverId === driverId) {
                vehicle.assignedDriverId = null
                await vehicle.save()
            }
        }

        cds.activeVehicleId = null
        await cds.save()

        return response.ok({ message: 'Active vehicle cleared' })
    }

    /**
     * Set active vehicle for driver in IDEP mode (Driver action)
     * Updates DriverSetting.activeVehicleId
     */
    async setActiveVehicleIDEP({ params, response, auth }: HttpContext) {
        const user = auth.user!

        if (!user.isDriver) {
            return response.forbidden({ message: 'Only drivers can set IDEP active vehicle' })
        }

        const vehicle = await Vehicle.find(params.id)
        if (!vehicle) {
            return response.notFound({ message: 'Vehicle not found' })
        }

        // Driver can only activate their own vehicles
        if (vehicle.ownerType !== 'User' || vehicle.ownerId !== user.id) {
            return response.forbidden({ message: 'You can only activate your own vehicles' })
        }

        const driverSetting = await DriverSetting.query()
            .where('userId', user.id)
            .first()

        if (!driverSetting) {
            return response.badRequest({ message: 'Driver settings not found' })
        }

        driverSetting.activeVehicleId = vehicle.id
        await driverSetting.save()

        return response.ok({
            message: 'Active IDEP vehicle set successfully',
            driverSetting
        })
    }

    /**
     * Clear active vehicle for driver in IDEP mode
     */
    async clearActiveVehicleIDEP({ response, auth }: HttpContext) {
        const user = auth.user!

        if (!user.isDriver) {
            return response.forbidden({ message: 'Only drivers can clear IDEP active vehicle' })
        }

        const driverSetting = await DriverSetting.query()
            .where('userId', user.id)
            .first()

        if (!driverSetting) {
            return response.badRequest({ message: 'Driver settings not found' })
        }

        driverSetting.activeVehicleId = null
        await driverSetting.save()

        return response.ok({ message: 'Active IDEP vehicle cleared' })
    }

    /**
     * Get the driver currently using this vehicle (if any)
     */
    async getActiveDriver({ params, response, auth }: HttpContext) {
        const user = auth.user!
        const vehicle = await Vehicle.find(params.id)

        if (!vehicle) {
            return response.notFound({ message: 'Vehicle not found' })
        }

        // Check access
        if (!(await this.canEditVehicle(user, vehicle.ownerType, vehicle.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        let activeDriver: User | null = null

        if (vehicle.ownerType === 'Company') {
            // Find CDS with this vehicle as active
            const cds = await CompanyDriverSetting.query()
                .where('activeVehicleId', vehicle.id)
                .preload('driver')
                .first()

            if (cds) {
                activeDriver = cds.driver
            }
        } else if (vehicle.ownerType === 'User') {
            // Find DriverSetting with this vehicle as active
            const ds = await DriverSetting.query()
                .where('activeVehicleId', vehicle.id)
                .preload('user')
                .first()

            if (ds) {
                activeDriver = ds.user
            }
        }

        return response.ok({
            vehicle: {
                id: vehicle.id,
                name: `${vehicle.brand} ${vehicle.model}`,
                plate: vehicle.plate,
                ownerType: vehicle.ownerType
            },
            activeDriver: activeDriver ? {
                id: activeDriver.id,
                fullName: activeDriver.fullName,
                phone: activeDriver.phone
            } : null
        })
    }

    /**
     * Upload a document for the vehicle
     */
    async uploadDoc({ params, request, response, auth }: HttpContext) {
        const vehicle = await Vehicle.find(params.id)
        if (!vehicle) {
            return response.notFound({ message: 'Vehicle not found' })
        }

        const user = auth.user!
        const file = request.file('file')
        const { docType, expiryDate } = request.body()

        if (!file) {
            return response.badRequest({ message: 'File is required' })
        }
        if (!['VEHICLE_INSURANCE', 'VEHICLE_TECHNICAL_VISIT', 'VEHICLE_REGISTRATION'].includes(docType)) {
            return response.badRequest({ message: 'Invalid docType' })
        }

        try {
            // Vérification de sécurité via la stratégie
            const DocumentSecurityService = (await import('#services/security/document_security_service')).default
            const canUpload = await DocumentSecurityService.canUpload(user, 'Vehicle', vehicle.id, docType)

            if (!canUpload) {
                return response.forbidden({
                    message: 'You are not authorized to upload documents for this vehicle'
                })
            }

            const result = await VehicleService.uploadDocument(user, vehicle.id, docType, file, expiryDate)
            return response.created(result)
        } catch (error) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List last 10 orders for a vehicle
     */
    async listOrders({ params, response, auth }: HttpContext) {
        const user = auth.user!
        const vehicle = await Vehicle.find(params.id)

        if (!vehicle) {
            return response.notFound({ message: 'Vehicle not found' })
        }

        // Check authorization
        // 1. My own vehicle
        if (vehicle.ownerType === 'User' && vehicle.ownerId === user.id) {
            // Authorized
        }
        // 2. Company vehicle
        else if (vehicle.ownerType === 'Company') {
            if (user.companyId !== vehicle.ownerId) {
                return response.forbidden({ message: 'Permission denied to view orders for this vehicle' })
            }
        } else {
            // If user is not owner and not in company, check if admin (optional, assuming canEditVehicle logic)
            if (!(await this.canEditVehicle(user, vehicle.ownerType, vehicle.ownerId))) {
                return response.forbidden({ message: 'Permission denied' })
            }
        }

        // Load orders
        await vehicle.load('orders', (query) => {
            query.preload('pickupAddress')
                .preload('deliveryAddress')
                .preload('client')
                .preload('driver')
                .orderBy('createdAt', 'desc')
                .limit(10)
        })

        return response.ok(vehicle.orders)
    }
}

