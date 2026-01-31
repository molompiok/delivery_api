import Document from '#models/document'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import app from '@adonisjs/core/services/app'

@inject()
export default class DocumentService {
    /**
     * List documents for a specific table and ID
     */
    async listDocuments(tableName: string, tableId: string, status?: string) {
        const query = Document.query()
            .where('tableName', tableName)
            .where('tableId', tableId)
            .where('isDeleted', false)
            .preload('file')

        if (status) {
            query.where('status', status)
        }

        return await query.orderBy('createdAt', 'desc')
    }

    /**
     * Get a single document
     */
    async getDocument(docId: string) {
        return await Document.query()
            .where('id', docId)
            .preload('file')
            .firstOrFail()
    }

    /**
     * Validate/Reject a global document (Admin only)
     */
    async validateDocument(admin: User, docId: string, status: 'APPROVED' | 'REJECTED', comment?: string) {
        if (!admin.isAdmin) throw new Error('Admin access required')

        const trx = await db.transaction()
        try {
            const document = await Document.query({ client: trx }).where('id', docId).forUpdate().firstOrFail()

            if (document.tableName !== 'User') {
                throw new Error('This method is only for global User documents.')
            }

            document.status = status
            document.validationComment = comment || null
            document.addHistory('ADMIN_VALIDATION', admin, { status, comment })
            await document.useTransaction(trx).save()

            if (status === 'APPROVED') {
                await this.checkAndUpdateDriverVerificationStatus(document.tableId, trx)
            }

            await trx.commit()
            return document
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Set expiry date for a document
     */
    async setExpiry(admin: User, docId: string, expireAt: string | null) {
        if (!admin.isAdmin) throw new Error('Admin access required')

        const document = await Document.findOrFail(docId)
        document.expireAt = expireAt ? DateTime.fromISO(expireAt) : null
        document.addHistory('EXPIRY_SET', admin, { expireAt })
        await document.save()

        return document
    }

    /**
     * Submit a file for a specific document placeholder
     */
    async submitFile(user: User, docId: string, fileId: string, expiryDate?: string) {
        const trx = await db.transaction()
        try {
            const document = await Document.query({ client: trx }).where('id', docId).forUpdate().firstOrFail()

            // Security check
            const canUpdate = await this.canUserUpdateDocument(user, document)
            if (!canUpdate) {
                throw new Error('You are not authorized to update this document')
            }

            // Update document
            document.fileId = fileId
            document.status = 'PENDING'
            if (expiryDate) {
                document.expireAt = DateTime.fromISO(expiryDate)
            }

            document.addHistory('FILE_SUBMITTED', user, { fileId, expiryDate })
            await document.useTransaction(trx).save()

            // Trigger specific sync logic
            await this.syncAfterSubmission(document, fileId, trx)

            await trx.commit()
            return document
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Sync after submission (logic moved from controller)
     */
    private async syncAfterSubmission(document: Document, fileId: string, trx?: any) {
        if (document.tableName === 'User') {
            const VerificationService = (await import('#services/verification_service')).default
            await VerificationService.syncDriverVerificationStatus(document.tableId, trx)
        } else if (document.tableName === 'CompanyDriverSetting') {
            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
            const relation = await CompanyDriverSetting.findOrFail(document.tableId, { client: trx })

            const File = (await import('#models/file')).default
            const sourceFile = await File.findOrFail(fileId, { client: trx })

            if (sourceFile.tableName !== 'CompanyDriverSetting' || sourceFile.tableId !== relation.id) {
                const FileManager = (await import('#services/file_manager')).default
                const manager = new FileManager(relation, 'CompanyDriverSetting')

                const targetColumn = `dct_${document.documentType}`
                const copiedFile = await manager.cloneFileAsHardLink(sourceFile, targetColumn)

                document.fileId = copiedFile.id
                await document.useTransaction(trx).save()

                await manager.getFileData(targetColumn, relation.companyId)
                await manager.share(targetColumn, {
                    read: { companyIds: [relation.companyId] }
                })
            }

            const CompanyService = (await import('#services/company_service')).default
            const companyService = await app.container.make(CompanyService)
            await companyService.syncDocsStatus(document.tableId, trx)
        } else if (document.tableName === 'Vehicle') {
            const VehicleService = (await import('#services/vehicle_service')).default
            const vehicleService = await app.container.make(VehicleService)
            await vehicleService.updateVehicleVerificationStatus(document.tableId, trx)
        }
    }

    /**
     * Bulk Add document placeholder
     */
    async bulkAddDocument(admin: User, documentType: string, label: string) {
        if (!admin.isAdmin) throw new Error('Admin access required')

        const trx = await db.transaction()
        try {
            const DriverSetting = (await import('#models/driver_setting')).default
            const drivers = await DriverSetting.query({ client: trx })

            let createdCount = 0
            for (const driver of drivers) {
                const exists = await Document.query({ client: trx })
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
                                actorId: admin.id,
                                note: `Document ajouté par l'admin: ${label}`
                            }]
                        }
                    }, { client: trx })
                    createdCount++
                }
            }
            await trx.commit()
            return createdCount
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Bulk Remove document placeholder
     */
    async bulkRemoveDocument(admin: User, documentType: string) {
        if (!admin.isAdmin) throw new Error('Admin access required')

        const result = await Document.query()
            .where('tableName', 'User')
            .where('documentType', documentType)
            .delete()

        return result[0]
    }

    /**
     * Add document to specific driver
     */
    async addDocumentToDriver(admin: User, userId: string, documentType: string, label: string) {
        if (!admin.isAdmin) throw new Error('Admin access required')

        const trx = await db.transaction()
        try {
            const exists = await Document.query({ client: trx })
                .where('tableName', 'User')
                .where('tableId', userId)
                .where('documentType', documentType)
                .first()

            if (exists) throw new Error('Document already exists for this driver')

            const doc = await Document.create({
                tableName: 'User',
                tableId: userId,
                documentType,
                status: 'PENDING',
                ownerId: userId,
                ownerType: 'User',
                isDeleted: false,
                metadata: {
                    history: [{
                        timestamp: DateTime.now().toISO(),
                        action: 'ADMIN_ADD',
                        actorId: admin.id,
                        note: `Document ajouté par l'admin: ${label}`
                    }]
                }
            }, { client: trx })

            await trx.commit()
            return doc
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Remove specific document
     */
    async removeDocument(admin: User, docId: string) {
        if (!admin.isAdmin) throw new Error('Admin access required')
        const trx = await db.transaction()
        try {
            const doc = await Document.query({ client: trx }).where('id', docId).forUpdate().firstOrFail()
            await doc.useTransaction(trx).delete()
            await trx.commit()
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Helper: Sync driver verification status
     */
    async checkAndUpdateDriverVerificationStatus(userId: string, trx?: any) {
        const client = trx || db
        const documents = await Document.query({ client })
            .where('tableName', 'User')
            .where('tableId', userId)
            .where('isDeleted', false)

        const allApproved = documents.length > 0 && documents.every(doc => doc.status === 'APPROVED')

        if (allApproved) {
            const DriverSetting = (await import('#models/driver_setting')).default
            const driverSetting = await DriverSetting.query({ client }).where('userId', userId).forUpdate().first()

            if (driverSetting && driverSetting.verificationStatus !== 'VERIFIED') {
                driverSetting.verificationStatus = 'VERIFIED'
                await driverSetting.useTransaction(client).save()
            }
        }
    }

    /**
     * Security check for updates
     */
    async canUserUpdateDocument(user: User, document: Document): Promise<boolean> {
        if (user.isAdmin) return true

        if (document.tableName === 'User' && document.tableId === user.id) return true

        if (document.tableName === 'CompanyDriverSetting') {
            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
            const relation = await CompanyDriverSetting.find(document.tableId)
            if (relation && relation.driverId === user.id) return true
        }

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
}
