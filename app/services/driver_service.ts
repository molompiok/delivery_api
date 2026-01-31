import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import DriverSetting from '#models/driver_setting'
import CompanyDriverSetting from '#models/company_driver_setting'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'

@inject()
export default class DriverService {
    /**
     * Register as driver
     */
    async register(user: User, data: { vehicleType?: string, vehiclePlate?: string }) {
        const trx = await db.transaction()
        try {
            let driverSetting = await DriverSetting.query({ client: trx }).where('userId', user.id).first()

            if (driverSetting) {
                driverSetting.merge({
                    vehicleType: data.vehicleType || driverSetting.vehicleType || 'MOTORCYCLE',
                    vehiclePlate: data.vehiclePlate || driverSetting.vehiclePlate || 'PENDING',
                })
                await driverSetting.useTransaction(trx).save()
            } else {
                driverSetting = await DriverSetting.create({
                    userId: user.id,
                    vehicleType: data.vehicleType || 'MOTORCYCLE',
                    vehiclePlate: data.vehiclePlate || 'PENDING',
                }, { client: trx })
            }

            if (!user.isDriver) {
                user.isDriver = true
                await user.useTransaction(trx).save()
                await this.ensureRequiredDocuments(user, trx)
            }

            await trx.commit()
            return driverSetting
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Ensure all required documents exist for a driver
     */
    async ensureRequiredDocuments(user: User, trx?: any) {
        if (!user.isDriver) return

        const { REQUIRED_DRIVER_DOCUMENTS } = await import('#constants/required_documents')
        const Document = (await import('#models/document')).default

        for (const req of REQUIRED_DRIVER_DOCUMENTS) {
            const typeKey = req.type.replace('dct_', '')
            const existing = await Document.query({ client: trx })
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
                }, { client: trx })
            }
        }
    }

    /**
     * Get driver profile
     */
    async getProfile(user: User) {
        if (!user.isDriver) throw new Error('User is not a driver')
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
        if (!user.isDriver) throw new Error('User is not a driver')
        const driverSetting = await DriverSetting.query().where('userId', user.id).firstOrFail()
        driverSetting.merge(data)
        await driverSetting.save()
        return driverSetting
    }

    /**
     * Get my documents
     */
    async listDocuments(user: User) {
        if (!user.isDriver) throw new Error('User is not a driver')
        await this.ensureRequiredDocuments(user)
        const Document = (await import('#models/document')).default
        return await Document.query()
            .where('tableName', 'User')
            .where('tableId', user.id)
            .where('isDeleted', false)
            .preload('file')
            .orderBy('createdAt', 'desc')
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
     * Accept access request
     */
    async acceptAccessRequest(user: User, relationId: string) {
        const trx = await db.transaction()
        try {
            const relation = await CompanyDriverSetting.query({ client: trx })
                .where('id', relationId)
                .where('driverId', user.id)
                .where('status', 'PENDING_ACCESS')
                .forUpdate()
                .firstOrFail()

            relation.status = 'ACCESS_ACCEPTED'
            await relation.useTransaction(trx).save()

            const FileManager = (await import('#services/file_manager')).default
            const File = (await import('#models/file')).default
            const Document = (await import('#models/document')).default

            const existingFiles = await File.query({ client: trx }).where('tableName', 'User').where('tableId', user.id)
            const manager = new FileManager(relation, 'CompanyDriverSetting')

            for (const sourceFile of existingFiles) {
                try {
                    const copiedFile = await manager.cloneFileAsHardLink(sourceFile, sourceFile.tableColumn)
                    const typeKey = sourceFile.tableColumn.replace('dct_', '')
                    const sourceDoc = await Document.query({ client: trx }).where('tableName', 'User').where('tableId', user.id).where('documentType', typeKey).first()
                    let doc = await Document.query({ client: trx }).where('tableName', 'CompanyDriverSetting').where('tableId', relation.id).where('documentType', typeKey).first()

                    if (!doc) {
                        doc = await Document.create({
                            tableName: 'CompanyDriverSetting',
                            tableId: relation.id,
                            documentType: typeKey,
                            ownerId: relation.companyId,
                            ownerType: 'Company',
                            status: 'PENDING',
                            isDeleted: false
                        }, { client: trx })
                    }

                    doc.fileId = copiedFile.id
                    doc.status = 'PENDING'

                    if (sourceDoc?.status === 'APPROVED') {
                        doc.addHistory('FILE_MIRRORED', user, { sourceFileId: sourceFile.id, note: 'Ce document a été précédemment validé par Sublymus' })
                    } else {
                        doc.addHistory('FILE_MIRRORED', user, { sourceFileId: sourceFile.id })
                    }
                    await doc.useTransaction(trx).save()
                    await manager.share(sourceFile.tableColumn, { read: { companyIds: [relation.companyId] } })
                } catch (err: any) {
                    console.error(`Failed to mirror file ${sourceFile.id}:`, err.message)
                }
            }
            await trx.commit()
            return relation
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Accept final fleet invitation
     */
    async acceptFleetInvitation(user: User, relationId: string) {
        const trx = await db.transaction()
        try {
            if (!user.isDriver) throw new Error('You must register as a driver first')
            const relation = await CompanyDriverSetting.query({ client: trx })
                .where('id', relationId)
                .where('driverId', user.id)
                .where('status', 'PENDING_FLEET')
                .forUpdate()
                .firstOrFail()

            relation.status = 'ACCEPTED'
            relation.acceptedAt = DateTime.now()
            await relation.useTransaction(trx).save()

            await DriverSetting.updateOrCreate({ userId: user.id }, { currentCompanyId: relation.companyId }, { client: trx })

            await trx.commit()
            return relation
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Reject request
     */
    async rejectRequest(user: User, relationId: string) {
        const invitation = await CompanyDriverSetting.query().where('id', relationId).where('driverId', user.id).whereIn('status', ['PENDING_ACCESS', 'PENDING_FLEET']).firstOrFail()
        invitation.status = 'REJECTED'
        await invitation.save()
        return true
    }

    /**
     * Get companies
     */
    async getCompanies(user: User) {
        return await CompanyDriverSetting.query().where('driverId', user.id).preload('company').orderBy('createdAt', 'desc')
    }

    /**
     * Upload a global document
     */
    async uploadDocument(ctx: any, user: User, docType: string) {
        const trx = await db.transaction()
        try {
            const FileManager = (await import('#services/file_manager')).default
            const manager = new FileManager(user, 'User')
            const typeKey = docType.replace('dct_', '')
            const normalizedDocType = `dct_${typeKey}`

            await manager.sync(ctx, { column: normalizedDocType, config: { encrypt: true } })

            const File = (await import('#models/file')).default
            const file = await File.query({ client: trx })
                .where('tableName', 'User')
                .where('tableId', user.id)
                .where('tableColumn', normalizedDocType)
                .orderBy('createdAt', 'desc')
                .firstOrFail()

            const Document = (await import('#models/document')).default
            let doc = await Document.query({ client: trx })
                .where('tableName', 'User')
                .where('tableId', user.id)
                .where('documentType', typeKey)
                .forUpdate()
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
                }, { client: trx })
            }

            doc.fileId = file.id
            doc.status = 'PENDING'
            doc.addHistory('FILE_UPLOADED', user, { fileId: file.id })
            await doc.useTransaction(trx).save()

            const VerificationService = (await import('#services/verification_service')).default
            await VerificationService.syncDriverVerificationStatus(user.id, trx)

            await trx.commit()
            return { file, document: doc }
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Update location (tracking)
     */
    async updateLocation(userId: string, lat: number, lng: number, heading?: number) {
        const TrackingService = (await import('#services/tracking_service')).default
        await TrackingService.track(userId, lat, lng, heading)
    }
}
