import User from '#models/user'
import DriverSetting from '#models/driver_setting'
import CompanyDriverSetting from '#models/company_driver_setting'
import { DateTime } from 'luxon'

export class DriverService {
    /**
     * Register as driver
     */
    async register(user: User, data: { vehicleType: string, vehiclePlate: string }) {
        const existingSetting = await DriverSetting.query()
            .where('userId', user.id)
            .first()

        if (existingSetting) {
            throw new Error('User is already registered as a driver')
        }

        const driverSetting = await DriverSetting.create({
            userId: user.id,
            ...data,
        })

        user.isDriver = true
        await user.save()

        return driverSetting
    }

    /**
     * Get driver profile
     */
    async getProfile(user: User) {
        if (!user.isDriver) {
            throw new Error('User is not a driver')
        }

        return await DriverSetting.query()
            .where('userId', user.id)
            .preload('currentCompany')
            .firstOrFail()
    }

    /**
     * Update driver profile
     */
    async updateProfile(user: User, data: { vehicleType?: string, vehiclePlate?: string }) {
        if (!user.isDriver) {
            throw new Error('User is not a driver')
        }

        const driverSetting = await DriverSetting.query()
            .where('userId', user.id)
            .firstOrFail()

        driverSetting.merge(data)
        await driverSetting.save()

        return driverSetting
    }

    /**
     * Get pending invitations
     */
    async getInvitations(user: User) {
        return await CompanyDriverSetting.query()
            .where('driverId', user.id)
            .whereIn('status', ['PENDING', 'PENDING_ACCESS', 'PENDING_FLEET'])
            .preload('company')
            .orderBy('invitedAt', 'desc')
    }

    /**
     * Step 4 & 5: Accept access request
     */
    async acceptAccessRequest(user: User, relationId: string) {
        const relation = await CompanyDriverSetting.query()
            .where('id', relationId)
            .where('driverId', user.id)
            .where('status', 'PENDING_ACCESS')
            .firstOrFail()

        relation.status = 'ACCESS_ACCEPTED'
        await relation.save()

        // Step 5: Mirror existing documents provided by the driver (User table files)
        // to the CompanyDriverSetting relation so the manager can see them.
        const FileService = (await import('#services/file_service')).default
        const File = (await import('#models/file')).default

        const Document = (await import('#models/document')).default
        const existingDocs = await File.query()
            .where('tableName', 'User')
            .where('tableId', user.id)

        for (const file of existingDocs) {
            try {
                const copied = await FileService.copyFile(file.id, {
                    tableName: 'CompanyDriverSetting',
                    tableId: relation.id,
                    tableColumn: file.tableColumn,
                    allowedCompanyIds: [relation.companyId]
                })

                // Find source Document to check for existing validation
                const sourceDoc = await Document.query()
                    .where('tableName', 'User')
                    .where('tableId', user.id)
                    .where('documentType', file.tableColumn.replace('dct_', ''))
                    .first()

                // Link to the Document model if a placeholder exists
                const doc = await Document.query()
                    .where('tableName', 'CompanyDriverSetting')
                    .where('tableId', relation.id)
                    .where('documentType', file.tableColumn.replace('dct_', ''))
                    .first()

                if (doc) {
                    doc.fileId = copied.fileId
                    doc.status = 'PENDING' // Mandatory: Manager must always validate themselves

                    if (sourceDoc?.status === 'APPROVED') {
                        doc.addHistory('FILE_MIRRORED', user, {
                            sourceFileId: file.id,
                            note: 'Ce document a été précédemment validé par Sublymus'
                        })
                    } else {
                        doc.addHistory('FILE_MIRRORED', user, { sourceFileId: file.id })
                    }
                    await doc.save()
                }
            } catch (err:any) {
                console.error(`Failed to mirror file ${file.id}:`, err.message)
            }
        }

        return relation
    }

    /**
     * Step 7: Accept final fleet invitation
     */
    async acceptFleetInvitation(user: User, relationId: string) {
        if (!user.isDriver) {
            throw new Error('You must register as a driver first')
        }

        const relation = await CompanyDriverSetting.query()
            .where('id', relationId)
            .where('driverId', user.id)
            .where('status', 'PENDING_FLEET')
            .firstOrFail()

        relation.status = 'ACCEPTED'
        relation.acceptedAt = DateTime.now()
        await relation.save()

        // Set as main company for the driver
        const driverSetting = await DriverSetting.updateOrCreate(
            { userId: user.id },
            { currentCompanyId: relation.companyId }
        )

        return relation
    }

    /**
     * Reject any request (access or fleet)
     */
    async rejectRequest(user: User, relationId: string) {
        const invitation = await CompanyDriverSetting.query()
            .where('id', relationId)
            .where('driverId', user.id)
            .whereIn('status', ['PENDING_ACCESS', 'PENDING_FLEET'])
            .firstOrFail()

        invitation.status = 'REJECTED'
        await invitation.save()

        return true
    }

    /**
     * Get companies associated with driver
     */
    async getCompanies(user: User) {
        return await CompanyDriverSetting.query()
            .where('driverId', user.id)
            .preload('company')
            .orderBy('createdAt', 'desc')
    }
}

export default new DriverService()
