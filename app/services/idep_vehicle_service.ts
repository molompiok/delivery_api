import Vehicle from '#models/vehicle'
import User from '#models/user'
import Document from '#models/document'
import { DateTime } from 'luxon'

export class IdepVehicleService {
    /**
     * Create a new vehicle for an independent driver (IDEP)
     * Automatically provisions required document records.
     */
    async createVehicle(user: User, data: any) {
        if (!user.isDriver) {
            throw new Error('User must be a driver to register an IDEP vehicle')
        }

        // 1. Create the vehicle
        const vehicle = await Vehicle.create({
            ownerType: 'User',
            ownerId: user.id,
            type: data.type,
            brand: data.brand,
            model: data.model,
            plate: data.plate,
            year: data.year,
            color: data.color,
            energy: data.energy,
            specs: data.specs,
            verificationStatus: 'PENDING',
        })

        // 2. Provision required documents (Sublymus standards)
        const requiredDocTypes = ['VEHICLE_REGISTRATION', 'VEHICLE_INSURANCE']

        // Add technical visit only if not a bicycle
        if (vehicle.type !== 'BICYCLE') {
            requiredDocTypes.push('VEHICLE_TECHNICAL_VISIT')
        }

        for (const docType of requiredDocTypes) {
            await Document.create({
                tableName: 'Vehicle',
                tableId: vehicle.id,
                documentType: docType,
                status: 'PENDING',
                ownerId: user.id,
                ownerType: 'User',
                isDeleted: false
            })
        }

        return vehicle
    }

    /**
     * List user's IDEP vehicles with their associated documents
     */
    async listVehicles(user: User) {
        const DriverSetting = (await import('#models/driver_setting')).default
        const ds = await DriverSetting.query().where('userId', user.id).first()
        const activeId = ds?.activeVehicleId

        const vehicles = await Vehicle.query()
            .where('ownerType', 'User')
            .where('ownerId', user.id)
            .orderBy('createdAt', 'desc')

        const result = []
        for (const vehicle of vehicles) {
            vehicle.$extras.isActive = vehicle.id === activeId

            const documents = await Document.query()
                .where('tableName', 'Vehicle')
                .where('tableId', vehicle.id)
                .where('isDeleted', false)
                .preload('file')

            result.push({
                ...vehicle.serialize(),
                documents: documents.map(d => d.serialize())
            })
        }

        return result
    }

    /**
     * Get a single IDEP vehicle with full document details
     */
    async getVehicle(user: User, vehicleId: string) {
        const DriverSetting = (await import('#models/driver_setting')).default
        const ds = await DriverSetting.query().where('userId', user.id).first()
        const activeId = ds?.activeVehicleId

        const vehicle = await Vehicle.query()
            .where('id', vehicleId)
            .where('ownerType', 'User')
            .where('ownerId', user.id)
            .firstOrFail()

        vehicle.$extras.isActive = vehicle.id === activeId

        const documents = await Document.query()
            .where('tableName', 'Vehicle')
            .where('tableId', vehicle.id)
            .where('isDeleted', false)
            .preload('file')

        return {
            ...vehicle.serialize(),
            documents: documents.map(d => d.serialize())
        }
    }
}

export default new IdepVehicleService()
