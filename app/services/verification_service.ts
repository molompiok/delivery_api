import DriverSetting from '#models/driver_setting'
import Company from '#models/company'
import Document from '#models/document'
import User from '#models/user'

export class VerificationService {
    /**
     * List pending driver verifications
     */
    async listPendingDrivers() {
        return await DriverSetting.query()
            .where('verificationStatus', 'PENDING')
            .preload('user')
    }

    /**
     * Get driver documents for admin review
     */
    async getDriverDocuments(driverId: string) {
        const user = await User.findOrFail(driverId)

        if (!user.isDriver) {
            throw new Error('User is not a driver')
        }

        // Get all documents for this driver (User table)
        const documents = await Document.query()
            .where('tableName', 'User')
            .where('tableId', driverId)
            .where('isDeleted', false)
            .preload('file')
            .orderBy('createdAt', 'desc')

        return {
            driver: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                phone: user.phone,
            },
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

        // Ensure this is a User document (not CompanyDriverSetting)
        if (doc.tableName !== 'User') {
            throw new Error('This endpoint only validates driver (User) documents')
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
     * List pending company verifications
     */
    async listPendingCompanies() {
        return await Company.query()
            .where('verificationStatus', 'PENDING')
            .preload('owner')
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
}

export default new VerificationService()
