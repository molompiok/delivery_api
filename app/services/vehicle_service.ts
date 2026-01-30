import Vehicle, { VehicleOwnerType } from '#models/vehicle'
import User from '#models/user'
import FileManager from '#services/file_manager'
import File from '#models/file'
import { DateTime } from 'luxon'
import { HttpContext } from '@adonisjs/core/http'

export class VehicleService {
    /**
     * Create or update a vehicle
     */
    async saveVehicle(data: Partial<Vehicle> & { ownerType: VehicleOwnerType, ownerId: string }) {
        if (data.id) {
            const vehicle = await Vehicle.findOrFail(data.id)
            vehicle.merge(data)
            await vehicle.save()
            return vehicle
        } else {
            // Set verification status to PENDING by default
            data.verificationStatus = 'PENDING'
            return await Vehicle.create(data)
        }
    }

    /**
     * Assign a driver to a vehicle (Company Managers only)
     */
    async assignDriver(vehicleId: string, driverId: string | null, manager: User) {
        const vehicle = await Vehicle.findOrFail(vehicleId)

        // Strict Check: Only Company vehicles can be assigned
        if (vehicle.ownerType !== 'Company') {
            throw new Error('Only company vehicles can be assigned to drivers')
        }

        // Strict Check: Manager must own this vehicle (via Company)
        if (!manager.effectiveCompanyId || vehicle.ownerId !== manager.effectiveCompanyId) {
            throw new Error('You do not own this vehicle')
        }

        // Initialize metadata if null
        if (!vehicle.metadata) {
            vehicle.metadata = {}
        }
        if (!vehicle.metadata.assignmentHistory) {
            vehicle.metadata.assignmentHistory = []
        }

        const historyEntry: any = {
            managerId: manager.id,
            managerName: manager.fullName || manager.phone,
            timestamp: DateTime.now().toISO(),
        }

        // Unassign
        if (!driverId) {
            historyEntry.action = 'UNASSIGNED'
            historyEntry.driverId = null
            historyEntry.driverName = 'None'

            vehicle.assignedDriverId = null
            vehicle.metadata.assignmentHistory.push(historyEntry)
            await vehicle.save()
            return vehicle
        }

        // Assign
        const driver = await User.findOrFail(driverId)

        // Strict Check: Driver must belong to the same company
        // Check direct companyId OR check CompanyDriverSetting
        if (driver.companyId !== manager.effectiveCompanyId) {
            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
            const companyRelation = await CompanyDriverSetting.query()
                .where('companyId', manager.effectiveCompanyId!)
                .where('driverId', driver.id)
                .where('status', 'ACCEPTED')
                .first()

            if (!companyRelation) {
                throw new Error('Driver does not belong to your company')
            }
        }

        historyEntry.action = 'ASSIGNED'
        historyEntry.driverId = driver.id
        historyEntry.driverName = driver.fullName || driver.phone

        vehicle.assignedDriverId = driverId
        vehicle.metadata.assignmentHistory.push(historyEntry)
        await vehicle.save()
        return vehicle
    }

    /**
     * List vehicles for an owner
     */
    async listVehicles(ownerType: VehicleOwnerType, ownerId: string) {
        return await Vehicle.query()
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .preload('assignedDriver') // Load driver info if exists
            .orderBy('createdAt', 'desc')
    }

    /**
     * Upload a document for a vehicle using the new FileManager
     * 
     * @param ctx - HTTP Context for file extraction
     * @param vehicle - The vehicle entity
     * @param docType - Type of document
     * @param user - The uploading user
     * @param expiryDate - Optional expiry date
     */
    async uploadDocument(
        ctx: HttpContext,
        vehicle: Vehicle,
        docType: 'VEHICLE_INSURANCE' | 'VEHICLE_TECHNICAL_VISIT' | 'VEHICLE_REGISTRATION',
        user: User,
        expiryDate?: string
    ) {
        /* 
        // Validation for expiry-sensitive docs (Optional now)
        if (['VEHICLE_INSURANCE', 'VEHICLE_TECHNICAL_VISIT'].includes(docType)) {
            if (!expiryDate) {
                throw new Error(`${docType} requires an expiry date`)
            }
            const date = DateTime.fromISO(expiryDate)
            if (!date.isValid || date < DateTime.now()) {
                throw new Error('Invalid or past expiry date')
            }
        }
        */

        const manager = new FileManager(vehicle, 'Vehicle')

        // Determine sharing based on owner type
        const isCompanyVehicle = vehicle.ownerType === 'Company'

        // Sync the document file (upload new, replace if update_id provided)
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

        // Set up permissions
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

        // Get the uploaded file info
        const files = await File.query()
            .where('tableName', 'Vehicle')
            .where('tableId', vehicle.id)
            .where('tableColumn', docType)
            .orderBy('createdAt', 'desc')
            .first()

        if (!files) {
            throw new Error('File upload failed')
        }

        // Create or update the Document
        const Document = (await import('#models/document')).default
        let doc = await Document.query()
            .where('tableName', 'Vehicle')
            .where('tableId', vehicle.id)
            .where('documentType', docType)
            .first()

        if (!doc) {
            doc = await Document.create({
                tableName: 'Vehicle',
                tableId: vehicle.id,
                documentType: docType,
                fileId: files.id,
                status: 'PENDING',
                ownerId: vehicle.ownerId,
                ownerType: vehicle.ownerType,
                isDeleted: false,
                expireAt: expiryDate ? DateTime.fromISO(expiryDate) : null
            })
            doc.addHistory('DOCUMENT_CREATED', user, {
                fileId: files.id,
                fileName: files.name,
                expiryDate
            })
        } else {
            doc.fileId = files.id
            doc.status = 'PENDING'
            doc.expireAt = expiryDate ? DateTime.fromISO(expiryDate) : null
            doc.addHistory('DOCUMENT_UPDATED', user, {
                fileId: files.id,
                fileName: files.name,
                expiryDate,
                previousStatus: doc.status
            })
        }

        await doc.save()

        return {
            file: files,
            document: doc
        }
    }

    /**
     * Valider un document de véhicule (Admin Sublymus uniquement)
     */
    async validateDocument(
        user: User,
        docId: string,
        status: 'APPROVED' | 'REJECTED',
        comment?: string
    ) {
        if (!user.isAdmin) {
            throw new Error('Only Sublymus admins can validate vehicle documents')
        }

        const Document = (await import('#models/document')).default
        const doc = await Document.findOrFail(docId)

        if (doc.tableName !== 'Vehicle') {
            throw new Error('This document is not a vehicle document')
        }

        doc.status = status
        doc.validationComment = comment || null
        doc.addHistory('VALIDATION_UPDATE', user, { status, comment })
        await doc.save()

        // Mettre à jour le statut de vérification du véhicule si nécessaire
        await this.updateVehicleVerificationStatus(doc.tableId)

        return doc
    }

    /**
     * Delete a vehicle and all its files
     */
    async deleteVehicle(vehicle: Vehicle) {
        const manager = new FileManager(vehicle, 'Vehicle')
        await manager.deleteAll()
        await vehicle.delete()
    }

    /**
     * Met à jour le statut de vérification du véhicule en fonction de ses documents
     */
    public async updateVehicleVerificationStatus(vehicleId: string) {
        const vehicle = await Vehicle.findOrFail(vehicleId)
        const Document = (await import('#models/document')).default

        const docs = await Document.query()
            .where('tableName', 'Vehicle')
            .where('tableId', vehicleId)
            .where('isDeleted', false)

        // Définir les documents requis selon le type de véhicule
        const requiredDocs = ['VEHICLE_REGISTRATION', 'VEHICLE_INSURANCE']
        if (vehicle.type !== 'BICYCLE') {
            requiredDocs.push('VEHICLE_TECHNICAL_VISIT')
        }

        let newStatus: 'PENDING' | 'APPROVED' | 'REJECTED' = 'APPROVED'

        for (const docType of requiredDocs) {
            const doc = docs.find(d => d.documentType === docType)

            if (!doc || doc.status === 'REJECTED') {
                newStatus = 'REJECTED'
                break
            }

            if (doc.status === 'PENDING') {
                newStatus = 'PENDING'
            }
        }

        vehicle.verificationStatus = newStatus
        await vehicle.save()

        return newStatus
    }
}

export default new VehicleService()
