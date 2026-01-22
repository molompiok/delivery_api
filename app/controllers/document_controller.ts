import type { HttpContext } from '@adonisjs/core/http'
import Document from '#models/document'
import User from '#models/user'
import { DateTime } from 'luxon'

export default class DocumentController {
    /**
     * List documents for a specific table and ID (Admin/Owner)
     */
    async listDocuments({ params, request, response }: HttpContext) {
        try {
            const { tableName, tableId } = params
            const { status } = request.qs()

            const query = Document.query()
                .where('tableName', tableName)
                .where('tableId', tableId)
                .where('isDeleted', false)
                .preload('file')

            if (status) {
                query.where('status', status)
            }

            const documents = await query.orderBy('createdAt', 'desc')
            return response.ok(documents)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get a single document
     */
    async getDocument({ params, response }: HttpContext) {
        try {
            const document = await Document.query()
                .where('id', params.docId)
                .preload('file')
                .firstOrFail()

            return response.ok(document)
        } catch (error: any) {
            return response.notFound({ message: 'Document not found' })
        }
    }

    /**
     * Validate/Reject a document (Admin only for global User documents)
     */
    async validateDocument({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!

            // Only admins can validate global documents
            if (!user.isAdmin) {
                return response.forbidden({ message: 'Admin access required' })
            }

            const { status, comment } = request.only(['status', 'comment'])

            if (!['APPROVED', 'REJECTED'].includes(status)) {
                return response.badRequest({ message: 'Status must be APPROVED or REJECTED' })
            }

            const document = await Document.findOrFail(params.docId)

            // Only allow validation of User documents (global Sublymus docs)
            if (document.tableName !== 'User') {
                return response.forbidden({
                    message: 'This endpoint is only for global User documents. Company documents should be validated via company routes.'
                })
            }

            // Update document status
            document.status = status as any
            document.validationComment = comment || null
            document.addHistory('ADMIN_VALIDATION', user, { status, comment })
            await document.save()

            // Update driver verification status if all docs are approved
            if (status === 'APPROVED') {
                await this.checkAndUpdateDriverVerificationStatus(document.tableId)
            }

            return response.ok({
                message: `Document ${status.toLowerCase()}`,
                document
            })
        } catch (error: any) {
            if (error.code === 'E_ROW_NOT_FOUND') {
                return response.notFound({ message: 'Document not found' })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Set expiry date for a document (Admin)
     */
    async setExpiry({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!

            if (!user.isAdmin) {
                return response.forbidden({ message: 'Admin access required' })
            }

            const { expireAt } = request.only(['expireAt'])

            const document = await Document.findOrFail(params.docId)
            document.expireAt = expireAt ? DateTime.fromISO(expireAt) : null
            document.addHistory('EXPIRY_SET', user, { expireAt })
            await document.save()

            return response.ok({
                message: 'Document expiry date updated',
                document
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Submit a file for a specific document placeholder
     */
    async submitFile({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const { fileId, expiryDate } = request.only(['fileId', 'expiryDate'])

            if (!fileId) {
                return response.badRequest({ message: 'fileId is required' })
            }

            const document = await Document.findOrFail(params.docId)

            // Security: Check if user owns the entity the document belongs to
            const canUpdate = await this.canUserUpdateDocument(user, document)
            if (!canUpdate) {
                return response.forbidden({ message: 'You are not authorized to update this document' })
            }

            // Update document
            document.fileId = fileId
            document.status = 'PENDING'
            if (expiryDate) {
                document.expireAt = DateTime.fromISO(expiryDate)
            }

            document.addHistory('FILE_SUBMITTED', user, { fileId, expiryDate })
            await document.save()

            // Trigger specific sync logic based on the table
            if (document.tableName === 'User') {
                const VerificationService = (await import('#services/verification_service')).default
                await VerificationService.syncDriverVerificationStatus(document.tableId)
            } else if (document.tableName === 'CompanyDriverSetting') {
                // MIRRORING: If a driver submits a file to a company relation, 
                // we should mirror it to ensure the manager has access and it exists in the relation's context.
                const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
                const relation = await CompanyDriverSetting.findOrFail(document.tableId)

                const File = (await import('#models/file')).default
                const sourceFile = await File.findOrFail(fileId)

                if (sourceFile.tableName !== 'CompanyDriverSetting' || sourceFile.tableId !== relation.id) {
                    const FileManager = (await import('#services/file_manager')).default
                    const manager = new FileManager(relation, 'CompanyDriverSetting')

                    // 1. Create a hard-link copy for the company relation context
                    const targetColumn = `dct_${document.documentType}`
                    const copiedFile = await manager.cloneFileAsHardLink(sourceFile, targetColumn)

                    // 2. Update the document to point to the relation's copy
                    document.fileId = copiedFile.id
                    await document.save()

                    // 3. Share with the company manager
                    await manager.getFileData(targetColumn, relation.companyId)
                    await manager.share(targetColumn, {
                        read: { companyIds: [relation.companyId] }
                    })
                }

                const CompanyService = (await import('#services/company_service')).default
                await CompanyService.syncDocsStatus(document.tableId)
            } else if (document.tableName === 'Vehicle') {
                const VehicleService = (await import('#services/vehicle_service')).default
                await VehicleService.updateVehicleVerificationStatus(document.tableId)
            }

            return response.ok({
                message: 'Document submitted successfully',
                document
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Helper: Check if user can update/submit a document
     */
    private async canUserUpdateDocument(user: User, document: Document): Promise<boolean> {
        if (user.isAdmin) return true

        // 1. User document: only the user themselves
        if (document.tableName === 'User' && document.tableId === user.id) {
            return true
        }

        // 2. CompanyDriverSetting document: either the driver (to submit) or manager (not usually)
        if (document.tableName === 'CompanyDriverSetting') {
            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
            const relation = await CompanyDriverSetting.find(document.tableId)
            if (relation && relation.driverId === user.id) return true
        }

        // 3. Vehicle document: owner (User or Company Manager)
        if (document.tableName === 'Vehicle') {
            const Vehicle = (await import('#models/vehicle')).default
            const vehicle = await Vehicle.find(document.tableId)
            if (vehicle) {
                if (vehicle.ownerType === 'User' && vehicle.ownerId === user.id) return true
                const activeCompanyId = user.currentCompanyManaged || user.companyId
                if (vehicle.ownerType === 'Company' && vehicle.ownerId === activeCompanyId) return true
            }
        }

        return false
    }

    /**
     * Admin: Add a document placeholder to all existing drivers
     */
    async bulkAddDocument({ request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            if (!user.isAdmin) return response.forbidden({ message: 'Admin access required' })

            const { documentType, label } = request.only(['documentType', 'label'])
            if (!documentType || !label) return response.badRequest({ message: 'documentType and label are required' })

            const DriverSetting = (await import('#models/driver_setting')).default
            const drivers = await DriverSetting.all()

            let createdCount = 0
            for (const driver of drivers) {
                // Check if already exists
                const exists = await Document.query()
                    .where('tableName', 'User')
                    .where('tableId', driver.userId)
                    .where('documentType', documentType)
                    .first()

                if (!exists) {
                    await Document.create({
                        tableName: 'User',
                        tableId: driver.userId,
                        documentType,
                        status: 'PENDING',
                        ownerId: driver.userId,
                        ownerType: 'User',
                        isDeleted: false,
                        metadata: {
                            history: [{
                                timestamp: DateTime.now().toISO(),
                                action: 'ADMIN_BULK_ADD',
                                actorId: user.id,
                                note: `Document ajouté par l'admin: ${label}`
                            }]
                        }
                    })
                    createdCount++
                }
            }

            return response.ok({ message: `Document placeholder created for ${createdCount} drivers` })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Admin: Remove a document type from all existing drivers
     */
    async bulkRemoveDocument({ request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            if (!user.isAdmin) return response.forbidden({ message: 'Admin access required' })

            const { documentType } = request.only(['documentType'])
            if (!documentType) return response.badRequest({ message: 'documentType is required' })

            const result = await Document.query()
                .where('tableName', 'User')
                .where('documentType', documentType)
                .delete()

            return response.ok({ message: `Removed document ${documentType} from ${result[0]} drivers` })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Admin: Add a document to a specific driver
     */
    async addDocumentToDriver({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            if (!user.isAdmin) return response.forbidden({ message: 'Admin access required' })

            const { driverId } = params // This is the userId
            const { documentType, label } = request.only(['documentType', 'label'])

            const exists = await Document.query()
                .where('tableName', 'User')
                .where('tableId', driverId)
                .where('documentType', documentType)
                .first()

            if (exists) return response.conflict({ message: 'Document already exists for this driver' })

            const doc = await Document.create({
                tableName: 'User',
                tableId: driverId,
                documentType,
                status: 'PENDING',
                ownerId: driverId,
                ownerType: 'User',
                isDeleted: false,
                metadata: {
                    history: [{
                        timestamp: DateTime.now().toISO(),
                        action: 'ADMIN_ADD',
                        actorId: user.id,
                        note: `Document ajouté par l'admin: ${label}`
                    }]
                }
            })

            return response.created({ message: 'Document added to driver', document: doc })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Admin: Remove a specific document from a driver
     */
    async removeDocumentFromDriver({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            if (!user.isAdmin) return response.forbidden({ message: 'Admin access required' })

            const { docId } = params
            const doc = await Document.findOrFail(docId)

            await doc.delete()

            return response.ok({ message: 'Document removed from driver' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Helper: Check if all required documents are approved and update driver verification status
     */
    private async checkAndUpdateDriverVerificationStatus(userId: string) {
        const DriverSetting = (await import('#models/driver_setting')).default

        // Get all User documents for this driver
        const documents = await Document.query()
            .where('tableName', 'User')
            .where('tableId', userId)
            .where('isDeleted', false)

        // Check if all documents are approved (or if there are no documents required)
        const allApproved = documents.length > 0 && documents.every(doc => doc.status === 'APPROVED')

        if (allApproved) {
            // Update driver verification status
            const driverSetting = await DriverSetting.query()
                .where('userId', userId)
                .first()

            if (driverSetting && driverSetting.verificationStatus !== 'VERIFIED') {
                driverSetting.verificationStatus = 'VERIFIED'
                await driverSetting.save()
            }
        }
    }
}
