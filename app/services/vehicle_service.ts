import Vehicle, { VehicleOwnerType } from '#models/vehicle'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import CompanyDriverSetting from '#models/company_driver_setting'
import FileManager from '#services/file_manager'
import File from '#models/file'
import { DateTime } from 'luxon'
import { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import DriverRelationNotifyService from '#services/driver_relation_notify_service'

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

        const vehicles = await Vehicle.query()
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .preload('assignedDriver')
            .orderBy('createdAt', 'desc')

        for (const vehicle of vehicles) {
            if (vehicle.assignedDriver) {
                await vehicle.assignedDriver.loadFiles()
            }
        }

        return vehicles
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
        if (vehicle.assignedDriver) {
            await vehicle.assignedDriver.loadFiles()
        }
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
            const previousAssignedDriverId = vehicle.assignedDriverId
            const activeCompanyId = manager.currentCompanyManaged || manager.companyId

            if (vehicle.ownerType !== 'Company') {
                throw new Error('Only company vehicles can be assigned to drivers')
            }

            if (!activeCompanyId) {
                throw new Error('Company context required')
            }

            if (!await this.canManageVehicle(manager, vehicle.ownerType, vehicle.ownerId)) {
                throw new Error('You do not own this vehicle')
            }

            if (!vehicle.metadata) vehicle.metadata = {}
            if (!vehicle.metadata.assignmentHistory) vehicle.metadata.assignmentHistory = []

            const baseHistory: any = {
                managerId: manager.id,
                managerName: manager.fullName || manager.phone,
                timestamp: DateTime.now().toISO(),
            }

            if (!driverId) {
                const staleRelations = await CompanyDriverSetting.query({ client: trx })
                    .where('companyId', activeCompanyId)
                    .where('activeVehicleId', vehicle.id)
                    .forUpdate()

                for (const relation of staleRelations) {
                    relation.activeVehicleId = null
                    await relation.useTransaction(trx).save()
                }

                vehicle.metadata.assignmentHistory.push({
                    ...baseHistory,
                    action: 'UNASSIGNED',
                    driverId: previousAssignedDriverId,
                })
                vehicle.assignedDriverId = null
                await vehicle.useTransaction(trx).save()
                await trx.commit()

                if (previousAssignedDriverId) {
                    await DriverRelationNotifyService.dispatch({
                        scope: 'ASSIGNMENT',
                        action: 'VEHICLE_UNASSIGNED',
                        message: 'Votre vehicule assigne a ete retire.',
                        driverId: previousAssignedDriverId,
                        companyId: vehicle.ownerId,
                        entity: {
                            vehicleId: vehicle.id,
                            plate: vehicle.plate,
                            brand: vehicle.brand,
                            model: vehicle.model,
                        },
                        push: {
                            title: 'Vehicule retire',
                            body: 'Votre vehicule assigne a ete retire.',
                            type: 'DRIVER_VEHICLE_UNASSIGNED',
                        },
                    })
                }
                return vehicle
            }

            const driver = await User.findOrFail(driverId, { client: trx })

            // Verify driver relationship
            const companyRelation = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', activeCompanyId!)
                .where('driverId', driver.id)
                .where('status', 'ACCEPTED')
                .forUpdate()
                .first()

            if (!companyRelation) {
                throw new Error('Driver does not belong to your company')
            }

            const previousVehicleForDriver = await Vehicle.query({ client: trx })
                .where('ownerType', 'Company')
                .where('ownerId', activeCompanyId)
                .where('assignedDriverId', driver.id)
                .whereNot('id', vehicle.id)
                .forUpdate()
                .first()

            if (previousVehicleForDriver) {
                if (!previousVehicleForDriver.metadata) previousVehicleForDriver.metadata = {}
                if (!previousVehicleForDriver.metadata.assignmentHistory) {
                    previousVehicleForDriver.metadata.assignmentHistory = []
                }

                previousVehicleForDriver.metadata.assignmentHistory.push({
                    ...baseHistory,
                    action: 'UNASSIGNED',
                    driverId: driver.id,
                    driverName: driver.fullName || driver.phone,
                    reason: 'REASSIGNED_TO_NEW_VEHICLE',
                    nextVehicleId: vehicle.id,
                })
                previousVehicleForDriver.assignedDriverId = null
                await previousVehicleForDriver.useTransaction(trx).save()
            }

            const staleRelations = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', activeCompanyId)
                .where('activeVehicleId', vehicle.id)
                .whereNot('driverId', driver.id)
                .forUpdate()

            for (const relation of staleRelations) {
                relation.activeVehicleId = null
                await relation.useTransaction(trx).save()
            }

            vehicle.assignedDriverId = driverId
            vehicle.metadata.assignmentHistory.push({
                ...baseHistory,
                action: 'ASSIGNED',
                driverId: driver.id,
                driverName: driver.fullName || driver.phone,
            })
            await vehicle.useTransaction(trx).save()

            companyRelation.activeVehicleId = vehicle.id
            await companyRelation.useTransaction(trx).save()
            await trx.commit()

            if (previousAssignedDriverId && previousAssignedDriverId !== driverId) {
                await DriverRelationNotifyService.dispatch({
                    scope: 'ASSIGNMENT',
                    action: 'VEHICLE_UNASSIGNED',
                    message: 'Votre vehicule assigne a ete retire.',
                    driverId: previousAssignedDriverId,
                    companyId: vehicle.ownerId,
                    entity: {
                        vehicleId: vehicle.id,
                        plate: vehicle.plate,
                        brand: vehicle.brand,
                        model: vehicle.model,
                    },
                    push: {
                        title: 'Vehicule retire',
                        body: 'Votre vehicule assigne a ete retire.',
                        type: 'DRIVER_VEHICLE_UNASSIGNED',
                    },
                })
            }

            if (previousVehicleForDriver && previousVehicleForDriver.id !== vehicle.id) {
                await DriverRelationNotifyService.dispatch({
                    scope: 'ASSIGNMENT',
                    action: 'VEHICLE_UNASSIGNED',
                    message: 'Votre ancien vehicule a ete desassigne.',
                    relationId: companyRelation.id,
                    driverId: driver.id,
                    companyId: vehicle.ownerId,
                    entity: {
                        vehicleId: previousVehicleForDriver.id,
                        plate: previousVehicleForDriver.plate,
                        brand: previousVehicleForDriver.brand,
                        model: previousVehicleForDriver.model,
                    },
                    push: {
                        enabled: false,
                    },
                })
            }

            await DriverRelationNotifyService.dispatch({
                scope: 'ASSIGNMENT',
                action: 'VEHICLE_ASSIGNED',
                message: `Vehicule assigne: ${vehicle.plate}.`,
                driverId: driver.id,
                companyId: vehicle.ownerId,
                entity: {
                    vehicleId: vehicle.id,
                    plate: vehicle.plate,
                    brand: vehicle.brand,
                    model: vehicle.model,
                },
                push: {
                    title: 'Vehicule assigne',
                    body: `Votre vehicule assigne est ${vehicle.plate}.`,
                    type: 'DRIVER_VEHICLE_ASSIGNED',
                },
            })
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

            // Keep 1 vehicle -> 1 driver
            const existing = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', activeCompanyId)
                .where('activeVehicleId', vehicle.id)
                .whereNot('driverId', driverId)
                .first()

            if (existing) {
                throw new Error('Vehicle is already assigned to another driver')
            }

            let previousVehicle: Vehicle | null = null
            if (cds.activeVehicleId && cds.activeVehicleId !== vehicle.id) {
                previousVehicle = await Vehicle.query({ client: trx })
                    .where('id', cds.activeVehicleId)
                    .forUpdate()
                    .first()

                if (previousVehicle?.assignedDriverId === driverId) {
                    if (!previousVehicle.metadata) previousVehicle.metadata = {}
                    if (!previousVehicle.metadata.assignmentHistory) {
                        previousVehicle.metadata.assignmentHistory = []
                    }
                    previousVehicle.metadata.assignmentHistory.push({
                        action: 'UNASSIGNED',
                        managerId: manager.id,
                        managerName: manager.fullName || manager.phone || manager.id,
                        driverId,
                        driverName: driverId,
                        timestamp: DateTime.now().toISO(),
                    })
                    previousVehicle.assignedDriverId = null
                    await previousVehicle.useTransaction(trx).save()
                }
            }

            const staleRelations = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', activeCompanyId)
                .where('activeVehicleId', vehicle.id)
                .whereNot('driverId', driverId)
                .forUpdate()

            for (const relation of staleRelations) {
                relation.activeVehicleId = null
                await relation.useTransaction(trx).save()
            }

            cds.activeVehicleId = vehicle.id
            await cds.useTransaction(trx).save()

            if (!vehicle.metadata) vehicle.metadata = {}
            if (!vehicle.metadata.assignmentHistory) vehicle.metadata.assignmentHistory = []
            vehicle.metadata.assignmentHistory.push({
                action: 'ASSIGNED',
                managerId: manager.id,
                managerName: manager.fullName || manager.phone || manager.id,
                driverId,
                driverName: driverId,
                timestamp: DateTime.now().toISO(),
            })
            vehicle.assignedDriverId = driverId
            await vehicle.useTransaction(trx).save()

            await trx.commit()

            if (previousVehicle && previousVehicle.id !== vehicle.id) {
                await DriverRelationNotifyService.dispatch({
                    scope: 'ASSIGNMENT',
                    action: 'VEHICLE_UNASSIGNED',
                    message: 'Votre ancien vehicule a ete desassigne.',
                    relationId: cds.id,
                    driverId: cds.driverId,
                    companyId: cds.companyId,
                    entity: {
                        vehicleId: previousVehicle.id,
                        plate: previousVehicle.plate,
                        brand: previousVehicle.brand,
                        model: previousVehicle.model,
                    },
                    push: {
                        enabled: false,
                    },
                })
            }

            await DriverRelationNotifyService.dispatch({
                scope: 'ASSIGNMENT',
                action: 'ACTIVE_VEHICLE_SET',
                message: `Vehicule actif defini: ${vehicle.plate}.`,
                relationId: cds.id,
                driverId: cds.driverId,
                companyId: cds.companyId,
                entity: {
                    vehicleId: vehicle.id,
                    plate: vehicle.plate,
                    brand: vehicle.brand,
                    model: vehicle.model,
                },
                push: {
                    title: 'Vehicule actif mis a jour',
                    body: `Votre vehicule actif est maintenant ${vehicle.plate}.`,
                    type: 'DRIVER_ACTIVE_VEHICLE_SET',
                },
            })
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

            const previousVehicleId = cds.activeVehicleId
            let previousVehiclePlate: string | null = null
            if (cds.activeVehicleId) {
                const vehicle = await Vehicle.find(cds.activeVehicleId, { client: trx })
                if (vehicle && vehicle.assignedDriverId === driverId) {
                    previousVehiclePlate = vehicle.plate
                    vehicle.assignedDriverId = null
                    await vehicle.useTransaction(trx).save()
                }
            }

            cds.activeVehicleId = null
            await cds.useTransaction(trx).save()
            await trx.commit()

            await DriverRelationNotifyService.dispatch({
                scope: 'ASSIGNMENT',
                action: 'ACTIVE_VEHICLE_CLEARED',
                message: 'Votre vehicule actif a ete retire.',
                relationId: cds.id,
                driverId: cds.driverId,
                companyId: cds.companyId,
                entity: {
                    previousVehicleId,
                    previousVehiclePlate,
                },
                push: {
                    title: 'Vehicule actif retire',
                    body: 'Votre vehicule actif a ete retire.',
                    type: 'DRIVER_ACTIVE_VEHICLE_CLEARED',
                },
            })
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

        const vehicle = await Vehicle.find(doc.tableId)
        if (vehicle?.ownerType === 'Company' && vehicle.assignedDriverId) {
            await DriverRelationNotifyService.dispatch({
                scope: 'DOCUMENT',
                action: status === 'APPROVED' ? 'VEHICLE_DOCUMENT_APPROVED' : 'VEHICLE_DOCUMENT_REJECTED',
                message:
                    status === 'APPROVED'
                        ? 'Un document de votre vehicule a ete valide.'
                        : 'Un document de votre vehicule a ete rejete.',
                driverId: vehicle.assignedDriverId,
                companyId: vehicle.ownerId,
                entity: {
                    vehicleId: vehicle.id,
                    plate: vehicle.plate,
                    documentId: doc.id,
                    documentType: doc.documentType,
                    status,
                },
                push: {
                    title: status === 'APPROVED' ? 'Document vehicule valide' : 'Document vehicule refuse',
                    body:
                        status === 'APPROVED'
                            ? 'Un document de votre vehicule vient d etre valide.'
                            : 'Un document de votre vehicule a ete rejete.',
                    type:
                        status === 'APPROVED'
                            ? 'DRIVER_VEHICLE_DOCUMENT_APPROVED'
                            : 'DRIVER_VEHICLE_DOCUMENT_REJECTED',
                },
            })
        }
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
