import Vehicle, { VehicleOwnerType } from '#models/vehicle'
import User from '#models/user'
import FileService from '#services/file_service'
import { MultipartFile } from '@adonisjs/core/bodyparser'
import { DateTime } from 'luxon'

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
        if (!manager.companyId || vehicle.ownerId !== manager.companyId) {
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
        if (driver.companyId !== manager.companyId) {
            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
            const companyRelation = await CompanyDriverSetting.query()
                .where('companyId', manager.companyId!)
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
     * Upload a document for a vehicle (Insurance, Technical Visit, Registration)
     * 
     * Cette méthode :
     * 1. Valide les dates d'expiration pour les docs sensibles
     * 2. Upload le fichier via FileService
     * 3. Crée ou met à jour le Document correspondant
     * 4. Ajoute l'historique de l'upload
     * 5. Gère les dates d'expiration
     */
    async uploadDocument(
        user: User,
        vehicleId: string,
        docType: 'VEHICLE_INSURANCE' | 'VEHICLE_TECHNICAL_VISIT' | 'VEHICLE_REGISTRATION',
        file: MultipartFile,
        expiryDate?: string
    ) {
        const vehicle = await Vehicle.findOrFail(vehicleId)

        // Validation for expiry-sensitive docs
        if (['VEHICLE_INSURANCE', 'VEHICLE_TECHNICAL_VISIT'].includes(docType)) {
            if (!expiryDate) {
                throw new Error(`${docType} requires an expiry date`)
            }
            const date = DateTime.fromISO(expiryDate)
            if (!date.isValid || date < DateTime.now()) {
                throw new Error('Invalid or past expiry date')
            }
        }

        const metadata = expiryDate ? { expiryDate } : undefined

        // Upload le fichier
        const result = await FileService.upload(file, {
            tableName: 'Vehicle',
            tableColumn: docType,
            tableId: vehicle.id,
            encrypt: true, // Sensitive docs
            allowedCategories: ['IMAGE', 'DOCS'],
            metadata: metadata,
            allowedCompanyIds: vehicle.ownerType === 'Company' ? [vehicle.ownerId] : undefined,
            allowedUserIds: vehicle.ownerType === 'User' ? [vehicle.ownerId] : undefined
        })

        // Créer ou mettre à jour le Document
        const Document = (await import('#models/document')).default
        let doc = await Document.query()
            .where('tableName', 'Vehicle')
            .where('tableId', vehicleId)
            .where('documentType', docType)
            .first()

        if (!doc) {
            // Créer un nouveau Document
            doc = await Document.create({
                tableName: 'Vehicle',
                tableId: vehicleId,
                documentType: docType,
                fileId: result.fileId,
                status: 'PENDING', // En attente de validation par admin Sublymus
                ownerId: vehicle.ownerId,
                ownerType: vehicle.ownerType,
                isDeleted: false,
                expireAt: expiryDate ? DateTime.fromISO(expiryDate) : null
            })
            doc.addHistory('DOCUMENT_CREATED', user, {
                fileId: result.fileId,
                fileName: result.name,
                expiryDate
            })
        } else {
            // Mettre à jour le Document existant
            doc.fileId = result.fileId
            doc.status = 'PENDING' // Reset à PENDING pour re-validation
            doc.expireAt = expiryDate ? DateTime.fromISO(expiryDate) : null
            doc.addHistory('DOCUMENT_UPDATED', user, {
                fileId: result.fileId,
                fileName: result.name,
                expiryDate,
                previousStatus: doc.status
            })
        }

        await doc.save()

        return {
            file: result,
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
     * Met à jour le statut de vérification du véhicule en fonction de ses documents
     */
    private async updateVehicleVerificationStatus(vehicleId: string) {
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
