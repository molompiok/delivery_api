import DriverSetting from '#models/driver_setting'
import Company from '#models/company'
import Document from '#models/document'
import User from '#models/user'

export class VerificationService {
    /**
     * List driver verifications with filters
     */
    async listPendingDrivers(page: number = 1, limit: number = 20, filter: string = 'all') {
        const query = DriverSetting.query().preload('user').orderBy('createdAt', 'desc')

        if (filter === 'completed') {
            query.where('verificationStatus', 'VERIFIED')
        } else if (filter === 'rejected') {
            query.whereHas('user', (u) => u.whereHas('documents', (d) => d.where('status', 'REJECTED')))
        } else if (filter === 'accepted') {
            query.whereHas('user', (u) => u.whereHas('documents', (d) => d.where('status', 'APPROVED')))
        } else if (filter === 'to_fill') {
            query.whereHas('user', (u) => u.whereHas('documents', (d) => d.where('status', 'PENDING').whereNull('fileId')))
        } else if (filter === 'waiting_admin') {
            query.whereHas('user', (u) => u.whereHas('documents', (d) => d.where('status', 'PENDING').whereNotNull('fileId')))
        } else if (filter === 'all') {
            // No extra where
        } else {
            // Default to only pending legacy behavior if needed, 
            // but the user wants "All" or specific categories.
            query.where('verificationStatus', 'PENDING')
        }

        return await query.paginate(page, limit)
    }

    /**
     * List pending vehicle verifications
     */
    async listPendingVehicles(page: number = 1, limit: number = 20) {
        const Vehicle = (await import('#models/vehicle')).default
        return await Vehicle.query()
            .where('verificationStatus', 'PENDING')
            .where('ownerType', 'User') // Specifically for IDEP vehicles
            .preload('ownerUser')
            .orderBy('createdAt', 'desc')
            .paginate(page, limit)
    }

    /**
     * Get full driver detail for admin review
     */
    async getDriverDetail(userId: string) {
        const driver = await DriverSetting.query()
            .where('userId', userId)
            .preload('user')
            .preload('currentCompany')
            .preload('activeZone')
            .preload('activeVehicle')
            .firstOrFail()

        // Get all documents for this driver
        const documents = await Document.query()
            .where('tableName', 'User')
            .where('tableId', userId)
            .where('isDeleted', false)
            .preload('file')
            .orderBy('createdAt', 'desc')

        // Also get vehicles owned by this driver (for IDEP)
        const Vehicle = (await import('#models/vehicle')).default
        const vehicles = await Vehicle.query()
            .where('ownerId', userId)
            .where('ownerType', 'User')

        const vehicleIds = vehicles.map(v => v.id)
        let vehicleDocuments: Document[] = []
        if (vehicleIds.length > 0) {
            vehicleDocuments = await Document.query()
                .where('tableName', 'Vehicle')
                .whereIn('tableId', vehicleIds)
                .where('isDeleted', false)
                .preload('file')
                .orderBy('createdAt', 'desc')
        }

        return {
            ...driver.toJSON(),
            documents: documents.map(doc => ({
                id: doc.id,
                documentType: doc.documentType,
                status: doc.status,
                file: doc.file ? {
                    id: doc.file.id,
                    name: doc.file.name,
                    mimeType: doc.file.mimeType,
                } : null,
                validationComment: doc.validationComment,
                expireAt: doc.expireAt,
            })),
            vehicles: vehicles.map(v => ({
                id: v.id,
                brand: v.brand,
                model: v.model,
                plate: v.plate,
                type: v.type,
                verificationStatus: v.verificationStatus,
                documents: vehicleDocuments.filter(d => d.tableId === v.id).map(doc => ({
                    id: doc.id,
                    documentType: doc.documentType,
                    status: doc.status,
                    file: doc.file ? {
                        id: doc.file.id,
                        name: doc.file.name,
                        mimeType: doc.file.mimeType,
                    } : null,
                    validationComment: doc.validationComment,
                    expireAt: doc.expireAt,
                }))
            }))
        }
    }

    /**
     * Validate or reject a driver document
     */
    async validateDocument(docId: string, status: 'APPROVED' | 'REJECTED', comment?: string, adminUser?: User) {
        if (!['APPROVED', 'REJECTED'].includes(status)) {
            throw new Error('Invalid status. Use APPROVED or REJECTED')
        }

        const doc = await Document.findOrFail(docId)

        // Ensure this is a User or Vehicle document
        if (!['User', 'Vehicle'].includes(doc.tableName)) {
            throw new Error('This endpoint only validates driver (User) or Vehicle documents')
        }

        doc.status = status
        doc.validationComment = comment || null

        if (adminUser) {
            doc.addHistory('ADMIN_VALIDATION', adminUser, { status, comment })
        }

        await doc.save()

        // Auto-update driver verification status based on docs
        await this.syncDriverVerificationStatus(doc.tableId)

        return doc
    }

    /**
     * Auto-sync driver verification status based on document statuses
     */
    async syncDriverVerificationStatus(userId: string) {
        const documents = await Document.query()
            .where('tableName', 'User')
            .where('tableId', userId)
            .where('isDeleted', false)

        if (documents.length === 0) {
            // No documents, keep as PENDING
            return
        }

        const allApproved = documents.every(doc => doc.status === 'APPROVED')
        const anyRejected = documents.some(doc => doc.status === 'REJECTED')
        const anyPending = documents.some(doc => doc.status === 'PENDING')

        const driverSetting = await DriverSetting.query()
            .where('userId', userId)
            .first()

        if (!driverSetting) return

        if (allApproved) {
            driverSetting.verificationStatus = 'VERIFIED'
        } else if (anyRejected) {
            driverSetting.verificationStatus = 'REJECTED'
        } else if (anyPending) {
            driverSetting.verificationStatus = 'PENDING'
        }

        await driverSetting.save()
        return driverSetting
    }

    /**
     * Verify a driver
     */
    async verifyDriver(driverId: string, status: 'VERIFIED' | 'REJECTED') {
        if (!['VERIFIED', 'REJECTED'].includes(status)) {
            throw new Error('Invalid status. Use VERIFIED or REJECTED')
        }

        const driverSetting = await DriverSetting.query()
            .where('userId', driverId)
            .first()

        if (!driverSetting) {
            throw new Error('Driver settings not found')
        }

        driverSetting.verificationStatus = status
        await driverSetting.save()

        return driverSetting
    }

    /**
     * List all companies with filters
     */
    async listCompanies(page: number = 1, limit: number = 20, status: string = 'all') {
        const query = Company.query().preload('owner').orderBy('createdAt', 'desc')

        if (status !== 'all') {
            query.where('verificationStatus', status.toUpperCase() as any)
        }

        return await query.paginate(page, limit)
    }

    /**
     * Get full company detail
     */
    async getCompanyDetail(companyId: string) {
        const company = await Company.query()
            .where('id', companyId)
            .preload('owner')
            .preload('vehicles')
            .firstOrFail()

        // Get manager (user who has currentCompanyManaged = companyId)
        const manager = await User.query()
            .where('currentCompanyManaged', companyId)
            .first()

        // Get all documents for this company
        const documents = await Document.query()
            .where('tableName', 'Company')
            .where('tableId', companyId)
            .where('isDeleted', false)
            .preload('file')
            .orderBy('createdAt', 'desc')

        return {
            ...company.toJSON(),
            manager: manager ? {
                id: manager.id,
                fullName: manager.fullName,
                email: manager.email,
                phone: manager.phone,
            } : null,
            documents: documents.map(doc => ({
                id: doc.id,
                documentType: doc.documentType,
                status: doc.status,
                file: doc.file ? {
                    id: doc.file.id,
                    name: doc.file.name,
                    mimeType: doc.file.mimeType,
                } : null,
                validationComment: doc.validationComment,
                expireAt: doc.expireAt,
            }))
        }
    }

    /**
     * List pending company verifications
     */
    async listPendingCompanies(page: number = 1, limit: number = 20) {
        return await this.listCompanies(page, limit, 'PENDING')
    }

    /**
     * Verify a company
     */
    async verifyCompany(companyId: string, status: 'VERIFIED' | 'REJECTED') {
        if (!['VERIFIED', 'REJECTED'].includes(status)) {
            throw new Error('Invalid status. Use VERIFIED or REJECTED')
        }

        const company = await Company.find(companyId)

        if (!company) {
            throw new Error('Company not found')
        }

        company.verificationStatus = status
        await company.save()

        return company
    }

    /**
     * Impersonate a company (Admin only)
     * Updates the admin's currentCompanyManaged field.
     */
    async impersonateCompany(admin: User, companyId: string) {
        if (!admin.isAdmin) {
            throw new Error('Only admins can impersonate companies')
        }

        // 1. Verify company exists
        const company = await Company.findOrFail(companyId)

        // 2. Update admin's currentCompanyManaged
        admin.currentCompanyManaged = company.id
        await admin.save()

        return {
            message: `Impersonating ${company.name}`,
            company: company.toJSON(),
            user: admin.toJSON()
        }
    }
}

export default new VerificationService()
