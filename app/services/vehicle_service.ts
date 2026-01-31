import Vehicle, { VehicleOwnerType } from '#models/vehicle'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import FileManager from '#services/file_manager'
import File from '#models/file'
import { DateTime } from 'luxon'
import { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'

@inject()
export default class VehicleService {
    /**
     * Check if a user can manage a vehicle
     */
    async canManageVehicle(user: User, ownerType: string, ownerId: string): Promise<boolean> {
        if (user.isAdmin) return true

        if (ownerType === 'User' && ownerId === user.id) return true

        if (ownerType === 'Company') {
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (activeCompanyId === ownerId) return true
        }

        return false
    }

    /**
     * List vehicles for an owner with permission check
     */
    async listVehicles(user: User, ownerType: VehicleOwnerType, ownerId: string) {
        if (!await this.canManageVehicle(user, ownerType, ownerId)) {
            throw new Error('Unauthorized to view these vehicles')
        }

        return await Vehicle.query()
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .preload('assignedDriver')
            .orderBy('createdAt', 'desc')
    }

    /**
     * Get single vehicle details
     */
    async getVehicleDetails(user: User, vehicleId: string) {
        const vehicle = await Vehicle.findOrFail(vehicleId)

        if (!await this.canManageVehicle(user, vehicle.ownerType, vehicle.ownerId)) {
            throw new Error('Unauthorized to view this vehicle')
        }

        await vehicle.load('assignedDriver')
        await vehicle.loadDocuments()
        return vehicle
    }

    /**
     * Create or update a vehicle
     */
    async saveVehicle(user: User, data: any) {
        if (!await this.canManageVehicle(user, data.ownerType, data.ownerId)) {
            throw new Error('Unauthorized to manage this vehicle')
        }

        const trx = await db.transaction()
        try {
            if (data.id) {
                const vehicle = await Vehicle.query({ client: trx }).where('id', data.id).forUpdate().firstOrFail()
                if (vehicle.ownerType !== data.ownerType || vehicle.ownerId !== data.ownerId) {
                    throw new Error('Vehicle ownership mismatch')
                }
                vehicle.merge(data)
                await vehicle.useTransaction(trx).save()
                await trx.commit()
                return vehicle
            } else {
                data.verificationStatus = 'PENDING'
                const vehicle = await Vehicle.create(data, { client: trx })
                await trx.commit()
                return vehicle
            }
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Delete a vehicle and its files
     */
    async deleteVehicle(user: User, vehicleId: string) {
        const trx = await db.transaction()
        try {
            const vehicle = await Vehicle.query({ client: trx }).where('id', vehicleId).forUpdate().firstOrFail()
            if (!await this.canManageVehicle(user, vehicle.ownerType, vehicle.ownerId)) {
                throw new Error('Unauthorized to delete this vehicle')
            }

            const manager = new FileManager(vehicle, 'Vehicle')
            await manager.deleteAll()
            await vehicle.useTransaction(trx).delete()
            await trx.commit()
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Assign driver (Manager only)
     */
    async assignDriver(vehicleId: string, driverId: string | null, manager: User) {
        const trx = await db.transaction()
        try {
            const vehicle = await Vehicle.query({ client: trx }).where('id', vehicleId).forUpdate().firstOrFail()

            if (vehicle.ownerType !== 'Company') {
                throw new Error('Only company vehicles can be assigned to drivers')
            }

            if (!await this.canManageVehicle(manager, vehicle.ownerType, vehicle.ownerId)) {
                throw new Error('You do not own this vehicle')
            }

            if (!vehicle.metadata) vehicle.metadata = {}
            if (!vehicle.metadata.assignmentHistory) vehicle.metadata.assignmentHistory = []

            const historyEntry: any = {
                managerId: manager.id,
                managerName: manager.fullName || manager.phone,
                timestamp: DateTime.now().toISO(),
            }

            if (!driverId) {
                historyEntry.action = 'UNASSIGNED'
                vehicle.assignedDriverId = null
                vehicle.metadata.assignmentHistory.push(historyEntry)
                await vehicle.useTransaction(trx).save()
                await trx.commit()
                return vehicle
            }

            const driver = await User.findOrFail(driverId, { client: trx })
            const activeCompanyId = manager.currentCompanyManaged || manager.companyId

            // Verify driver relationship
            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
            const companyRelation = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', activeCompanyId!)
                .where('driverId', driver.id)
                .where('status', 'ACCEPTED')
                .first()

            if (!companyRelation) {
                throw new Error('Driver does not belong to your company')
            }

            historyEntry.action = 'ASSIGNED'
            historyEntry.driverId = driver.id
            historyEntry.driverName = driver.fullName || driver.phone

            vehicle.assignedDriverId = driverId
            vehicle.metadata.assignmentHistory.push(historyEntry)
            await vehicle.useTransaction(trx).save()
            await trx.commit()
            return vehicle
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Set active vehicle in ETP mode
     */
    async setActiveVehicleETP(manager: User, vehicleId: string, driverId: string) {
        const trx = await db.transaction()
        try {
            const activeCompanyId = manager.currentCompanyManaged || manager.companyId
            if (!activeCompanyId) throw new Error('Company context required')

            const vehicle = await Vehicle.query({ client: trx })
                .where('id', vehicleId)
                .where('ownerId', activeCompanyId)
                .where('ownerType', 'Company')
                .forUpdate()
                .firstOrFail()

            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
            const cds = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', activeCompanyId)
                .where('driverId', driverId)
                .forUpdate()
                .firstOrFail()

            // Conflict check
            const existing = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', activeCompanyId)
                .where('activeVehicleId', vehicle.id)
                .whereNot('driverId', driverId)
                .first()

            if (existing) {
                throw new Error('Vehicle is already assigned to another driver')
            }

            cds.activeVehicleId = vehicle.id
            await cds.useTransaction(trx).save()

            vehicle.assignedDriverId = driverId
            await vehicle.useTransaction(trx).save()

            await trx.commit()
            return cds
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Clear active vehicle in ETP mode
     */
    async clearActiveVehicleETP(manager: User, driverId: string) {
        const trx = await db.transaction()
        try {
            const activeCompanyId = manager.currentCompanyManaged || manager.companyId
            if (!activeCompanyId) throw new Error('Company context required')

            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
            const cds = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', activeCompanyId)
                .where('driverId', driverId)
                .forUpdate()
                .firstOrFail()

            if (cds.activeVehicleId) {
                const vehicle = await Vehicle.find(cds.activeVehicleId, { client: trx })
                if (vehicle && vehicle.assignedDriverId === driverId) {
                    vehicle.assignedDriverId = null
                    await vehicle.useTransaction(trx).save()
                }
            }

            cds.activeVehicleId = null
            await cds.useTransaction(trx).save()
            await trx.commit()
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Set active vehicle in IDEP mode
     */
    async setActiveVehicleIDEP(driver: User, vehicleId: string) {
        const trx = await db.transaction()
        try {
            if (!driver.isDriver) throw new Error('Only drivers can set IDEP active vehicle')

            const vehicle = await Vehicle.findOrFail(vehicleId, { client: trx })
            if (vehicle.ownerType !== 'User' || vehicle.ownerId !== driver.id) {
                throw new Error('You can only activate your own vehicles')
            }

            const DriverSetting = (await import('#models/driver_setting')).default
            const ds = await DriverSetting.query({ client: trx }).where('userId', driver.id).forUpdate().firstOrFail()

            ds.activeVehicleId = vehicle.id
            await ds.useTransaction(trx).save()
            await trx.commit()
            return ds
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Clear active vehicle in IDEP mode
     */
    async clearActiveVehicleIDEP(driver: User) {
        if (!driver.isDriver) throw new Error('Only drivers can clear IDEP active vehicle')

        const DriverSetting = (await import('#models/driver_setting')).default
        const ds = await DriverSetting.query().where('userId', driver.id).firstOrFail()

        ds.activeVehicleId = null
        await ds.save()
    }

    /**
     * Get active driver for a vehicle
     */
    async getActiveDriver(user: User, vehicleId: string) {
        const vehicle = await Vehicle.findOrFail(vehicleId)
        if (!await this.canManageVehicle(user, vehicle.ownerType, vehicle.ownerId)) {
            throw new Error('Unauthorized')
        }

        let activeDriver: User | null = null

        if (vehicle.ownerType === 'Company') {
            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
            const cds = await CompanyDriverSetting.query()
                .where('activeVehicleId', vehicle.id)
                .preload('driver')
                .first()
            if (cds) activeDriver = cds.driver
        } else {
            const DriverSetting = (await import('#models/driver_setting')).default
            const ds = await DriverSetting.query()
                .where('activeVehicleId', vehicle.id)
                .preload('user')
                .first()
            if (ds) activeDriver = ds.user
        }

        return activeDriver
    }

    /**
     * List last 10 orders for a vehicle
     */
    async listVehicleOrders(user: User, vehicleId: string) {
        const vehicle = await Vehicle.findOrFail(vehicleId)

        // Authorization check logic moved from controller
        let authorized = false
        if (user.isAdmin) authorized = true
        else if (vehicle.ownerType === 'User' && vehicle.ownerId === user.id) authorized = true
        else if (vehicle.ownerType === 'Company' && (user.companyId === vehicle.ownerId || user.currentCompanyManaged === vehicle.ownerId)) authorized = true

        if (!authorized) throw new Error('Unauthorized to view orders for this vehicle')

        await vehicle.load('orders', (query) => {
            query.preload('stops', (q) => q.preload('address'))
                .preload('client')
                .preload('driver')
                .orderBy('createdAt', 'desc')
                .limit(10)
        })

        return vehicle.orders
    }

    /**
     * Upload a document for a vehicle
     */
    async uploadDocument(
        ctx: HttpContext,
        vehicleId: string,
        docType: 'VEHICLE_INSURANCE' | 'VEHICLE_TECHNICAL_VISIT' | 'VEHICLE_REGISTRATION',
        user: User,
        expiryDate?: string
    ) {
        const trx = await db.transaction()
        try {
            const vehicle = await Vehicle.query({ client: trx }).where('id', vehicleId).forUpdate().firstOrFail()

            // Security check
            const DocumentSecurityService = (await import('#services/security/document_security_service')).default
            const canUpload = await DocumentSecurityService.canUpload(user, 'Vehicle', vehicle.id, docType)
            if (!canUpload) throw new Error('Unauthorized to upload documents for this vehicle')

            const manager = new FileManager(vehicle, 'Vehicle')
            const isCompanyVehicle = vehicle.ownerType === 'Company'

            await manager.sync(ctx, {
                column: docType,
                isPublic: false,
                config: {
                    allowedExt: ['pdf', 'jpg', 'jpeg', 'png'],
                    maxSize: '10MB',
                    maxFiles: 1,
                    encrypt: true
                }
            })

            if (isCompanyVehicle) {
                await manager.share(docType, {
                    read: { companyIds: [vehicle.ownerId] },
                    write: { companyIds: [vehicle.ownerId] }
                })
            } else {
                await manager.share(docType, {
                    read: { userIds: [vehicle.ownerId] },
                    write: { userIds: [vehicle.ownerId] }
                })
            }

            const file = await File.query({ client: trx })
                .where('tableName', 'Vehicle')
                .where('tableId', vehicle.id)
                .where('tableColumn', docType)
                .orderBy('createdAt', 'desc')
                .firstOrFail()

            const Document = (await import('#models/document')).default
            let doc = await Document.query({ client: trx })
                .where('tableName', 'Vehicle')
                .where('tableId', vehicle.id)
                .where('documentType', docType)
                .forUpdate()
                .first()

            if (!doc) {
                doc = await Document.create({
                    tableName: 'Vehicle',
                    tableId: vehicle.id,
                    documentType: docType,
                    fileId: file.id,
                    status: 'PENDING',
                    ownerId: vehicle.ownerId,
                    ownerType: vehicle.ownerType,
                    isDeleted: false,
                    expireAt: expiryDate ? DateTime.fromISO(expiryDate) : null
                }, { client: trx })
                doc.addHistory('DOCUMENT_CREATED', user, { fileId: file.id, fileName: file.name, expiryDate })
            } else {
                doc.fileId = file.id
                doc.status = 'PENDING'
                doc.expireAt = expiryDate ? DateTime.fromISO(expiryDate) : null
                doc.addHistory('DOCUMENT_UPDATED', user, { fileId: file.id, fileName: file.name, expiryDate })
            }

            await doc.useTransaction(trx).save()
            await this.updateVehicleVerificationStatus(vehicle.id, trx)

            await trx.commit()
            return { file, document: doc }
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Validate a vehicle document (Admin)
     */
    async validateDocument(user: User, docId: string, status: 'APPROVED' | 'REJECTED', comment?: string) {
        if (!user.isAdmin) throw new Error('Only Sublymus admins can validate vehicle documents')

        const Document = (await import('#models/document')).default
        const doc = await Document.findOrFail(docId)

        if (doc.tableName !== 'Vehicle') throw new Error('Not a vehicle document')

        doc.status = status
        doc.validationComment = comment || null
        doc.addHistory('VALIDATION_UPDATE', user, { status, comment })
        await doc.save()

        await this.updateVehicleVerificationStatus(doc.tableId)
        return doc
    }

    /**
     * Update vehicle verification status
     */
    public async updateVehicleVerificationStatus(vehicleId: string, trx?: any) {
        const client = trx || db
        const vehicle = await Vehicle.findOrFail(vehicleId, { client })
        const Document = (await import('#models/document')).default

        const docs = await Document.query({ client })
            .where('tableName', 'Vehicle')
            .where('tableId', vehicleId)
            .where('isDeleted', false)

        const requiredDocs = ['VEHICLE_REGISTRATION', 'VEHICLE_INSURANCE']
        if (vehicle.type !== 'BICYCLE') requiredDocs.push('VEHICLE_TECHNICAL_VISIT')

        let newStatus: 'PENDING' | 'APPROVED' | 'REJECTED' = 'APPROVED'

        for (const docType of requiredDocs) {
            const doc = docs.find(d => d.documentType === docType)
            if (!doc || doc.status === 'REJECTED') {
                newStatus = 'REJECTED'
                break
            }
            if (doc.status === 'PENDING') newStatus = 'PENDING'
        }

        vehicle.verificationStatus = newStatus
        await vehicle.useTransaction(client).save()
        return newStatus
    }
}
