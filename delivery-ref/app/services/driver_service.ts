import User from '#models/user'
import DriverSetting from '#models/driver_setting'
import CompanyDriverSetting from '#models/company_driver_setting'
import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'

export class DriverService {
    /**
     * Register as driver
     */
    async register(user: User, data: { vehicleType?: string, vehiclePlate?: string }) {
        let driverSetting = await DriverSetting.query()
            .where('userId', user.id)
            .first()

        if (driverSetting) {
            // Idempotent: Update existing setting if it somehow exists
            driverSetting.merge({
                vehicleType: data.vehicleType || driverSetting.vehicleType || 'MOTORCYCLE',
                vehiclePlate: data.vehiclePlate || driverSetting.vehiclePlate || 'PENDING',
            })
            await driverSetting.save()
        } else {
            driverSetting = await DriverSetting.create({
                userId: user.id,
                vehicleType: data.vehicleType || 'MOTORCYCLE',
                vehiclePlate: data.vehiclePlate || 'PENDING',
            })
        }

        if (!user.isDriver) {
            user.isDriver = true
            await user.save()
            await this.ensureRequiredDocuments(user)
        }

        return driverSetting
    }

    /**
     * Ensure all required documents exist for a driver (creates placeholders if missing)
     */
    async ensureRequiredDocuments(user: User) {
        if (!user.isDriver) return

        const { REQUIRED_DRIVER_DOCUMENTS } = await import('#constants/required_documents')
        const Document = (await import('#models/document')).default

        for (const req of REQUIRED_DRIVER_DOCUMENTS) {
            const typeKey = req.type.replace('dct_', '')

            // We use updateOrCreate but we DON'T update the status if it already exists
            // To be safer, we can check existence first
            const existing = await Document.query()
                .where('tableName', 'User')
                .where('tableId', user.id)
                .where('documentType', typeKey)
                .first()

            if (!existing) {
                await Document.create({
                    tableName: 'User',
                    tableId: user.id,
                    documentType: typeKey,
                    ownerId: user.id,
                    ownerType: 'User',
                    status: 'PENDING',
                    isDeleted: false
                })
            }
        }
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
            .preload('user')
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
        const FileManager = (await import('#services/file_manager')).default
        const File = (await import('#models/file')).default
        const Document = (await import('#models/document')).default

        const existingFiles = await File.query()
            .where('tableName', 'User')
            .where('tableId', user.id)

        const manager = new FileManager(relation, 'CompanyDriverSetting')

        for (const sourceFile of existingFiles) {
            try {
                // 1. Create a hard-link copy for the company
                const copiedFile = await manager.cloneFileAsHardLink(sourceFile, sourceFile.tableColumn)

                // 2. Find/Update the Document record for this relation
                const typeKey = sourceFile.tableColumn.replace('dct_', '')

                // Source doc for status check
                const sourceDoc = await Document.query()
                    .where('tableName', 'User')
                    .where('tableId', user.id)
                    .where('documentType', typeKey)
                    .first()

                // Target doc (CompanyDriverSetting)
                let doc = await Document.query()
                    .where('tableName', 'CompanyDriverSetting')
                    .where('tableId', relation.id)
                    .where('documentType', typeKey)
                    .first()

                if (!doc) {
                    // Create if doesn't exist (e.g. if company didn't specify required docs yet but driver has them)
                    doc = await Document.create({
                        tableName: 'CompanyDriverSetting',
                        tableId: relation.id,
                        documentType: typeKey,
                        ownerId: relation.companyId,
                        ownerType: 'Company',
                        status: 'PENDING',
                        isDeleted: false
                    })
                }

                doc.fileId = copiedFile.id
                doc.status = 'PENDING' // Always reset to PENDING for company manager validation

                if (sourceDoc?.status === 'APPROVED') {
                    doc.addHistory('FILE_MIRRORED', user, {
                        sourceFileId: sourceFile.id,
                        note: 'Ce document a été précédemment validé par Sublymus'
                    })
                } else {
                    doc.addHistory('FILE_MIRRORED', user, { sourceFileId: sourceFile.id })
                }

                await doc.save()

                // 3. Ensure FileData permissions for the company manager
                // (FileManager.getFileData handles this when called)
                await manager.getFileData(sourceFile.tableColumn, relation.companyId)
                await manager.share(sourceFile.tableColumn, {
                    read: { companyIds: [relation.companyId] }
                })
            } catch (err: any) {
                console.error(`Failed to mirror file ${sourceFile.id}:`, err.message)
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

    /**
     * Upload a document for the driver (Global User Doc)
     */
    async uploadDocument(ctx: any, user: User, docType: string) {
        console.log('[DEBUG] uploadDocument docType:', docType)
        console.log('[DEBUG] request files:', ctx.request.files(docType))
        console.log('[DEBUG] request file single:', ctx.request.file(docType))

        const FileManager = (await import('#services/file_manager')).default
        const manager = new FileManager(user, 'User')

        const typeKey = docType.replace('dct_', '')
        const normalizedDocType = `dct_${typeKey}`

        // 1. Sync with FileManager
        await manager.sync(ctx, {
            column: normalizedDocType,
            config: { encrypt: true } // Documents are encrypted by default
        })

        // 2. Get the file record
        const File = (await import('#models/file')).default
        const file = await File.query()
            .where('tableName', 'User')
            .where('tableId', user.id)
            .where('tableColumn', normalizedDocType)
            .orderBy('createdAt', 'desc')
            .first()

        if (!file) throw new Error('File upload failed')

        // 3. Link to Document record
        const Document = (await import('#models/document')).default
        let doc = await Document.query()
            .where('tableName', 'User')
            .where('tableId', user.id)
            .where('documentType', typeKey)
            .first()

        if (!doc) {
            doc = await Document.create({
                tableName: 'User',
                tableId: user.id,
                documentType: typeKey,
                ownerId: user.id,
                ownerType: 'User',
                status: 'PENDING',
                isDeleted: false
            })
        }

        doc.fileId = file.id
        doc.status = 'PENDING'
        doc.addHistory('FILE_UPLOADED', user, { fileId: file.id })
        await doc.save()

        // 4. Update the verification status if needed
        const VerificationService = (await import('#services/verification_service')).default
        await VerificationService.syncDriverVerificationStatus(user.id)

        return { file, document: doc }
    }
}

export default new DriverService()
