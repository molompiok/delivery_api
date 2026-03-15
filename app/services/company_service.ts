import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import Company from '#models/company'
import CompanyDriverSetting from '#models/company_driver_setting'
import SmsService from '#services/sms_service'
import NotificationService from '#services/notification_service'
import WalletProvisioningService from '#services/wallet_provisioning_service'
import DriverRelationNotifyService from '#services/driver_relation_notify_service'
import subscriptionService from '#services/subscription_service'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import env from '#start/env'
import { OrderTemplate } from '#constants/order_templates'

@inject()
export default class CompanyService {
    private normalizeTemplate(value: string | null | undefined, field: 'activityType' | 'defaultTemplate'): OrderTemplate {
        const normalized = String(value || '').trim().toUpperCase()
        if (!['COMMANDE', 'VOYAGE', 'MISSION'].includes(normalized)) {
            throw new Error(
                `E_INVALID_${field.toUpperCase()}: "${value}" is not supported. Allowed values: COMMANDE, VOYAGE, MISSION`
            )
        }
        return normalized as OrderTemplate
    }
    /**
     * Create a company
     */
    async create(ctx: HttpContext, user: User, data: { name: string, activityType: OrderTemplate, registreCommerce?: string, logo?: string, description?: string }) {
        if (user.companyId) {
            throw new Error('User already owns a company')
        }

        const activityType = this.normalizeTemplate(data.activityType, 'activityType')
        await subscriptionService.ensurePlanCanBeAssignedToCompany(activityType)

        const company = await Company.create({
            ...data,
            activityType,
            ownerId: user.id,
            // Par défaut, le template d'usage est le même que l'identité métier à la création
            defaultTemplate: activityType
        })

        user.companyId = company.id
        user.currentCompanyManaged = company.id
        await user.save()

        // Best effort wallet provisioning
        await WalletProvisioningService.ensureUserWallet(user)
        await WalletProvisioningService.ensureCompanyWallet(company)

        // Sync Logo if multipart request
        const FileManager = (await import('#services/file_manager')).default
        const manager = new FileManager(company, 'Company')
        await manager.sync(ctx, {
            column: 'logo',
            isPublic: true,
            config: {
                allowedExt: ['jpg', 'jpeg', 'png', 'webp', 'svg'],
                maxSize: '2MB',
                maxFiles: 1,
            },
        })

        // Update primary logoPath column with the actual filename after sync
        const paths = await FileManager.getPathsFor('Company', company.id, 'logo')
        if (paths.length > 0) {
            company.logoPath = paths[0]
            await company.save()
        }

        await company.loadFiles()
        return company
    }

    /**
     * Update company
     */
    async update(
        ctx: HttpContext,
        user: User,
        data: {
            name?: string
            registreCommerce?: string
            logo?: string
            description?: string
            activityType?: string
            defaultTemplate?: string
        }
    ) {
        const activeCompanyId = user.currentCompanyManaged || user.companyId
        if (!activeCompanyId) {
            throw new Error('User does not own a company')
        }

        const company = await Company.findOrFail(activeCompanyId)
        const patch: any = {
            name: data.name,
            registreCommerce: data.registreCommerce,
            description: data.description,
        }

        if (typeof data.logo === 'string') {
            company.logoPath = data.logo
        } else if (company.logoPath && company.logoPath.startsWith('{')) {
            // Fix corrupted data from previous failed attempts
            company.logoPath = null
        }

        if (data.activityType !== undefined) {
            const nextActivityType = this.normalizeTemplate(data.activityType, 'activityType')
            await subscriptionService.ensurePlanCanBeAssignedToCompany(nextActivityType)
            company.activityType = nextActivityType
            if (data.defaultTemplate === undefined) {
                company.defaultTemplate = nextActivityType
            }
        }

        if (data.defaultTemplate !== undefined) {
            company.defaultTemplate = this.normalizeTemplate(data.defaultTemplate, 'defaultTemplate')
        }

        const nextActivityType = (company.activityType || '').toUpperCase()
        const nextDefaultTemplate = (company.defaultTemplate || '').toUpperCase()
        if (nextActivityType === 'COMMANDE' && nextDefaultTemplate && nextDefaultTemplate !== 'COMMANDE') {
            throw new Error(
                `E_ACTIVITY_DEFAULT_TEMPLATE_FORBIDDEN: company activityType=COMMANDE cannot set defaultTemplate=${nextDefaultTemplate}. Allowed defaultTemplate: COMMANDE.`
            )
        }

        company.merge(patch)
        await company.save()

        // Sync Logo if multipart request
        if (user && user.id) {
            const FileManager = (await import('#services/file_manager')).default
            const manager = new FileManager(company, 'Company')
            await manager.sync(ctx, {
                column: 'logo',
                isPublic: true,
                config: {
                    allowedExt: ['jpg', 'jpeg', 'png', 'webp', 'svg'],
                    maxSize: '2MB',
                    maxFiles: 1,
                },
            })

            // Update primary logoPath column with the actual filename after sync
            const paths = await FileManager.getPathsFor('Company', company.id, 'logo')
            if (paths.length > 0) {
                company.logoPath = paths[0]
                await company.save()
            } else if (ctx.request.input('logo_delete')) {
                company.logoPath = null
                await company.save()
            }
        }

        await company.loadFiles()
        return company
    }

    /**
     * Get company details
     */
    async getCompanyDetails(user: User) {
        const activeCompanyId = user.currentCompanyManaged || user.companyId
        if (!activeCompanyId) throw new Error('User does not belong to a company')
        const company = await Company.findOrFail(activeCompanyId)
        await company.loadFiles()
        return company
    }

    /**
     * Invite a driver
     */
    async inviteDriver(user: User, phone: string) {
        const trx = await db.transaction()
        try {
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (!activeCompanyId) {
                throw new Error('User does not own a company')
            }

            // 1. Find or create the driver
            const driver = await User.firstOrCreate({ phone }, {
                isDriver: true,
                isActive: true,
                phone: phone,
            }, { client: trx })

            // 2. Find or create the relationship
            const relation = await CompanyDriverSetting.updateOrCreate(
                {
                    companyId: activeCompanyId,
                    driverId: driver.id,
                },
                {
                    status: 'PENDING_ACCESS',
                    invitedAt: DateTime.now(),
                    acceptedAt: null
                },
                { client: trx }
            )

            // 3. Initialize documents from Company metadata requirements
            await this.syncRequiredDocsFromMetadata(user, driver.id, trx)

            // 4. Send SMS notification with download URL
            const company = await Company.findOrFail(activeCompanyId, { client: trx })
            await trx.commit()

            // Best effort wallet provisioning (new or legacy records)
            await WalletProvisioningService.ensureUserWallet(driver, { entityType: 'DRIVER' })
            await WalletProvisioningService.ensureCompanyWallet(company)
            await WalletProvisioningService.ensureCompanyDriverWallet(relation.id)
            await relation.refresh()

            const downloadUrl = env.get('DRIVER_APP_DOWNLOAD_URL', 'http://delivery.sublymus.com/download/driver-app')
            await SmsService.send({
                to: phone,
                content: `Bonjour, l'entreprise ${company.name} souhaite vous recruter sur Sublymus. Téléchargez l'app : ${downloadUrl} puis connectez-vous pour accepter.`
            })

            // 5. Send push notification if driver already has the app
            try {
                await NotificationService.sendInvitationAlert(driver, company.name, 'PENDING_ACCESS')
            } catch (pushError: any) {
                console.warn(`[INVITE] Push notification failed for ${driver.id}:`, pushError.message)
            }

            await DriverRelationNotifyService.dispatch({
                scope: 'INVITATION',
                action: 'INVITE_SENT',
                message: `${company.name} vous invite a rejoindre la flotte.`,
                relationId: relation.id,
                driverId: relation.driverId,
                companyId: relation.companyId,
                entity: {
                    status: relation.status,
                    companyName: company.name,
                },
                push: {
                    enabled: false,
                },
            })

            return relation
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Sync required documents from Company metadata
     */
    async syncRequiredDocsFromMetadata(user: User, driverId: string, trx?: any) {
        const activeCompanyId = user.currentCompanyManaged || user.companyId
        if (!activeCompanyId) throw new Error('Company access required')

        const company = await Company.findOrFail(activeCompanyId, { client: trx })
        const requirements = company.metaData?.documentRequirements || []

        if (requirements.length === 0) return

        const docTypeIds = requirements.map((r: any) => r.id)
        return await this.setRequiredDocs(user, driverId, docTypeIds, trx)
    }

    /**
     * Remove a driver
     */
    async removeDriver(user: User, driverId: string) {
        const activeCompanyId = user.currentCompanyManaged || user.companyId
        if (!activeCompanyId) {
            throw new Error('User does not own a company')
        }

        const companyDriver = await CompanyDriverSetting.query()
            .where('companyId', activeCompanyId)
            .where('driverId', driverId)
            .where('status', 'ACCEPTED')
            .firstOrFail()

        companyDriver.status = 'REMOVED'
        await companyDriver.save()

        await DriverRelationNotifyService.dispatch({
            scope: 'ASSIGNMENT',
            action: 'REMOVED_FROM_COMPANY',
            message: 'Vous ne faites plus partie de cette flotte.',
            relationId: companyDriver.id,
            driverId: companyDriver.driverId,
            companyId: companyDriver.companyId,
            entity: {
                status: companyDriver.status,
            },
            push: {
                title: 'Acces retire',
                body: 'Votre acces a cette entreprise a ete retire.',
                type: 'DRIVER_REMOVED_FROM_COMPANY',
            },
        })

        return true
    }

    /**
     * List drivers
     */
    async listDrivers(user: User, filters: { status?: string, name?: string, email?: string, phone?: string } = {}) {
        const activeCompanyId = user.currentCompanyManaged || user.companyId
        if (!activeCompanyId) {
            throw new Error('User does not own a company')
        }

        const query = CompanyDriverSetting.query()
            .where('companyId', activeCompanyId)
            .preload('driver', (q) => {
                q.preload('driverSetting')
            })

        if (filters.status) {
            query.where('status', filters.status)
        } else {
            query.whereIn('status', ['ACCEPTED', 'PENDING', 'PENDING_ACCESS', 'ACCESS_ACCEPTED', 'PENDING_FLEET', 'REJECTED'])
        }

        if (filters.name || filters.email || filters.phone) {
            query.whereHas('driver', (q) => {
                if (filters.name) q.where('fullName', 'ilike', `%${filters.name}%`)
                if (filters.email) q.where('email', 'ilike', `%${filters.email}%`)
                if (filters.phone) q.where('phone', 'ilike', `%${filters.phone}%`)
            })
        }

        const drivers = await query.orderBy('status', 'asc').orderBy('invitedAt', 'desc')

        // Load photos for all drivers in the list
        await Promise.all(drivers.map((d) => d.driver.loadFiles()))

        return drivers
    }

    /**
     * Get Driver Details
     */
    async getDriverDetails(user: User, driverId: string) {
        const activeCompanyId = user.currentCompanyManaged || user.companyId
        if (!activeCompanyId) {
            throw new Error('User does not own a company')
        }

        const relation = await CompanyDriverSetting.query()
            .where('companyId', activeCompanyId)
            .where('driverId', driverId)
            .preload('driver', (q) => {
                q.preload('driverSetting')
                q.preload('zones')
            })
            .firstOrFail()

        if (relation.driver) {
            await relation.driver.loadFiles()
        }

        const Vehicle = (await import('#models/vehicle')).default
        const vehicle = await Vehicle.findBy('assignedDriverId', driverId)

        let orders: any[] = []
        try {
            const Order = (await import('#models/order')).default
            orders = await Order.query()
                .where('driverId', driverId)
                .preload('stops', (q) => q.preload('address'))
                .orderBy('createdAt', 'desc')
                .limit(5)
        } catch (e) { }

        const Schedule = (await import('#models/schedule')).default
        const assignedSchedules = await Schedule.query()
            .whereHas('assignedUsers', (q) => {
                q.where('users.id', driverId)
            })
            .where('isActive', true)
            .orderBy('startTime', 'asc')

        return {
            ...relation.serialize(),
            currentVehicle: vehicle ? vehicle.serialize() : null,
            recentOrders: orders.map(o => o.serialize()),
            assignedSchedules: assignedSchedules.map(s => s.serialize()),
            assignedZones: relation.driver.zones.map(z => z.serialize()),
            documents: (await relation.related('documents').query().where('isDeleted', false).preload('file')).map(d => d.serialize())
        }
    }

    /**
     * Set required documents for a driver
     */
    async setRequiredDocs(user: User, driverId: string, docTypeIds: string[], trx?: any) {
        const outerTrx = trx || await db.transaction()
        try {
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (!activeCompanyId) throw new Error('Company access required')

            const relation = await CompanyDriverSetting.query({ client: outerTrx })
                .where('companyId', activeCompanyId)
                .where('driverId', driverId)
                .firstOrFail()

            relation.requiredDocTypes = docTypeIds
            await relation.useTransaction(outerTrx).save()

            const Document = (await import('#models/document')).default
            const existingDocs = await Document.query({ client: outerTrx })
                .where('tableName', 'CompanyDriverSetting')
                .where('tableId', relation.id)

            const newTypeKeys = docTypeIds.map(id => id.replace('dct_', ''))

            for (const doc of existingDocs) {
                if (!newTypeKeys.includes(doc.documentType)) {
                    if ((doc.metadata?.history || []).length > 0 || doc.fileId !== null) {
                        doc.isDeleted = true
                        doc.addHistory('REMOVED_FROM_REQUIREMENTS', user)
                        await doc.useTransaction(outerTrx).save()
                    } else {
                        await doc.useTransaction(outerTrx).delete()
                    }
                }
            }

            for (const typeKey of newTypeKeys) {
                const existing = existingDocs.find(d => d.documentType === typeKey)
                if (existing) {
                    if (existing.isDeleted) {
                        existing.isDeleted = false
                        existing.status = 'PENDING'
                        existing.addHistory('RESTORED_TO_REQUIREMENTS', user)
                        await existing.useTransaction(outerTrx).save()
                    }
                } else {
                    await Document.create({
                        tableName: 'CompanyDriverSetting',
                        tableId: relation.id,
                        documentType: typeKey,
                        status: 'PENDING',
                        ownerId: relation.companyId,
                        ownerType: 'Company',
                        isDeleted: false
                    }, { client: outerTrx })
                }
            }

            await this.syncDocsStatus(relation.id, outerTrx)

            if (!trx) await outerTrx.commit()

            if (!trx) {
                await DriverRelationNotifyService.dispatch({
                    scope: 'DOCUMENT',
                    action: 'REQUIRED_DOCS_UPDATED',
                    message: 'La liste des documents requis a ete mise a jour.',
                    relationId: relation.id,
                    driverId: relation.driverId,
                    companyId: relation.companyId,
                    entity: {
                        requiredDocTypes: relation.requiredDocTypes || [],
                    },
                    push: {
                        title: 'Documents requis modifies',
                        body: 'La liste des documents demandes a ete mise a jour.',
                        type: 'DRIVER_REQUIRED_DOCS_UPDATED',
                    },
                })
            }

            return relation
        } catch (error) {
            if (!trx) await outerTrx.rollback()
            throw error
        }
    }

    /**
     * Re-calculate and sync the global docsStatus for a relation
     */
    async syncDocsStatus(relationId: string, trx?: any) {
        const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
        const relation = await CompanyDriverSetting.findOrFail(relationId, { client: trx })

        const docs = await relation.related('documents').query().where('isDeleted', false)
        const requiredDocTypes = (relation.requiredDocTypes || []).map(t => t.replace('dct_', ''))

        let newStatus: 'APPROVED' | 'PENDING' | 'REJECTED' = 'APPROVED'

        if (requiredDocTypes.length > 0) {
            for (const type of requiredDocTypes) {
                const doc = docs.find(d => d.documentType === type)
                if (!doc || doc.status === 'REJECTED') {
                    newStatus = 'REJECTED'
                    break
                }
                if (doc.status === 'PENDING') newStatus = 'PENDING'
            }
        }

        relation.docsStatus = newStatus
        await relation.useTransaction(trx).save()
        return newStatus
    }

    /**
     * Validate an individual document
     */
    async validateDocument(user: User, docId: string, status: 'APPROVED' | 'REJECTED', comment?: string) {
        const trx = await db.transaction()
        try {
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (!activeCompanyId) throw new Error('Company access required')

            const Document = (await import('#models/document')).default
            const doc = await Document.query({ client: trx }).where('id', docId).forUpdate().firstOrFail()

            if (doc.tableName !== 'CompanyDriverSetting' || doc.ownerId !== activeCompanyId) {
                throw new Error('Not authorized')
            }

            doc.status = status as any
            doc.validationComment = comment || null
            doc.addHistory('VALIDATION_UPDATE', user, { status, comment })
            await doc.useTransaction(trx).save()

            await this.syncDocsStatus(doc.tableId, trx)
            const relation = await CompanyDriverSetting.findOrFail(doc.tableId, { client: trx })
            await trx.commit()

            await DriverRelationNotifyService.dispatch({
                scope: 'DOCUMENT',
                action: status === 'APPROVED' ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED',
                message:
                    status === 'APPROVED'
                        ? 'Un de vos documents a ete valide.'
                        : 'Un de vos documents a ete rejete.',
                relationId: relation.id,
                driverId: relation.driverId,
                companyId: relation.companyId,
                entity: {
                    documentId: doc.id,
                    documentType: doc.documentType,
                    status,
                    comment: comment || null,
                },
                push: {
                    title: status === 'APPROVED' ? 'Document valide' : 'Document refuse',
                    body:
                        status === 'APPROVED'
                            ? 'Un document vient d etre valide par votre entreprise.'
                            : 'Un document a ete refuse. Verifiez le commentaire.',
                    type:
                        status === 'APPROVED'
                            ? 'DRIVER_DOCUMENT_APPROVED'
                            : 'DRIVER_DOCUMENT_REJECTED',
                },
            })

            return doc
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Invite to fleet
     */
    async inviteToFleet(user: User, driverId: string) {
        const trx = await db.transaction()
        try {
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (!activeCompanyId) throw new Error('Company access required')

            const relation = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', activeCompanyId)
                .where('driverId', driverId)
                .where('status', 'ACCESS_ACCEPTED')
                .forUpdate()
                .firstOrFail()

            const requiredTypes = (relation.requiredDocTypes || []).map(t => t.replace('dct_', ''))
            const docs = await relation.related('documents').query()

            for (const type of requiredTypes) {
                const doc = docs.find(d => d.documentType === type)
                if (!doc || doc.status !== 'APPROVED') {
                    throw new Error(`Le document "${type}" doit être validé.`)
                }
            }

            relation.status = 'PENDING_FLEET'
            await relation.useTransaction(trx).save()

            const driver = await User.findOrFail(relation.driverId, { client: trx })
            const company = await Company.findOrFail(activeCompanyId, { client: trx })

            await trx.commit()

            if (driver.phone) {
                await SmsService.send({
                    to: driver.phone,
                    content: `Félicitations ! Vos documents ont été validés par ${company.name}. Connectez-vous pour rejoindre officiellement la flotte.`
                })
            }

            await DriverRelationNotifyService.dispatch({
                scope: 'INVITATION',
                action: 'FLEET_INVITED',
                message: `${company.name} vous invite a rejoindre officiellement la flotte.`,
                relationId: relation.id,
                driverId: relation.driverId,
                companyId: relation.companyId,
                entity: {
                    status: relation.status,
                    companyName: company.name,
                },
                push: {
                    title: 'Invitation flotte',
                    body: `${company.name} vous invite a rejoindre la flotte.`,
                    type: 'DRIVER_FLEET_INVITATION',
                },
            })
            return relation
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Upload a document for a driver
     */
    async uploadDocument(ctx: any, user: User, relationId: string, docType: string) {
        const trx = await db.transaction()
        try {
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (!activeCompanyId) throw new Error('Company access required')

            const relation = await CompanyDriverSetting.query({ client: trx })
                .where('id', relationId)
                .where('companyId', activeCompanyId)
                .forUpdate()
                .firstOrFail()

            const FileManager = (await import('#services/file_manager')).default
            const manager = new FileManager(relation, 'CompanyDriverSetting')
            const typeKey = docType.replace('dct_', '')

            await manager.sync(ctx, { column: docType, config: { encrypt: true } })

            const File = (await import('#models/file')).default
            const file = await File.query({ client: trx })
                .where('tableName', 'CompanyDriverSetting')
                .where('tableId', relation.id)
                .where('tableColumn', docType)
                .orderBy('createdAt', 'desc')
                .firstOrFail()

            const Document = (await import('#models/document')).default
            let doc = await Document.query({ client: trx })
                .where('tableName', 'CompanyDriverSetting')
                .where('tableId', relation.id)
                .where('documentType', typeKey)
                .forUpdate()
                .first()

            if (!doc) {
                doc = await Document.create({
                    tableName: 'CompanyDriverSetting',
                    tableId: relation.id,
                    documentType: typeKey,
                    ownerId: activeCompanyId,
                    ownerType: 'Company',
                    status: 'PENDING',
                    isDeleted: false
                }, { client: trx })
            }

            doc.fileId = file.id
            doc.status = 'PENDING'
            doc.addHistory('FILE_UPLOADED', user, { fileId: file.id })
            await doc.useTransaction(trx).save()

            await this.syncDocsStatus(relation.id, trx)
            await trx.commit()

            await DriverRelationNotifyService.dispatch({
                scope: 'DOCUMENT',
                action: 'DOCUMENT_UPLOADED_BY_COMPANY',
                message: 'Un document a ete ajoute par l entreprise.',
                relationId: relation.id,
                driverId: relation.driverId,
                companyId: relation.companyId,
                entity: {
                    documentId: doc.id,
                    documentType: doc.documentType,
                    status: doc.status,
                },
                push: {
                    title: 'Nouveau document',
                    body: 'Un document a ete ajoute sur votre dossier entreprise.',
                    type: 'DRIVER_COMPANY_DOCUMENT_UPLOADED',
                },
            })

            return { file, document: doc }
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Upload a document for the company
     */
    async uploadCompanyDocument(ctx: any, user: User, docType: string) {
        const trx = await db.transaction()
        try {
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (!activeCompanyId) throw new Error('Company access required')

            const company = await Company.findOrFail(activeCompanyId, { client: trx })
            const FileManager = (await import('#services/file_manager')).default
            const manager = new FileManager(company, 'Company')
            const typeKey = docType.replace('dct_', '')

            await manager.sync(ctx, { column: docType, config: { encrypt: true } })

            const File = (await import('#models/file')).default
            const file = await File.query({ client: trx })
                .where('tableName', 'Company')
                .where('tableId', company.id)
                .where('tableColumn', docType)
                .orderBy('createdAt', 'desc')
                .firstOrFail()

            const Document = (await import('#models/document')).default
            let doc = await Document.query({ client: trx })
                .where('tableName', 'Company')
                .where('tableId', company.id)
                .where('documentType', typeKey)
                .forUpdate()
                .first()

            if (!doc) {
                doc = await Document.create({
                    tableName: 'Company',
                    tableId: company.id,
                    documentType: typeKey,
                    ownerId: company.id,
                    ownerType: 'Company',
                    status: 'PENDING',
                    isDeleted: false
                }, { client: trx })
            }

            doc.fileId = file.id
            doc.status = 'PENDING'
            doc.addHistory('FILE_UPLOADED', user, { fileId: file.id })
            await doc.useTransaction(trx).save()

            await trx.commit()
            return { file, document: doc }
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Get Company Document Requirements
     */
    async getDocumentRequirements(user: User) {
        const activeCompanyId = user.currentCompanyManaged || user.companyId
        if (!activeCompanyId) throw new Error('Company access required')
        const company = await Company.findOrFail(activeCompanyId)
        return company.metaData?.documentRequirements || []
    }

    /**
     * Update Company Document Requirements
     */
    async updateDocumentRequirements(user: User, requirements: any[]) {
        const activeCompanyId = user.currentCompanyManaged || user.companyId
        if (!activeCompanyId) throw new Error('Company access required')
        const company = await Company.findOrFail(activeCompanyId)

        const metaData = { ...(company.metaData || {}) }
        metaData.documentRequirements = requirements

        company.metaData = metaData
        await company.save()

        return company.metaData.documentRequirements
    }

    /**
     * Get Driver Stats (Missions, Success Rate, Revenue, Excellence)
     */
    async getDriverStats(user: User, driverId: string) {
        const activeCompanyId = user.currentCompanyManaged || user.companyId
        if (!activeCompanyId) throw new Error('Company access required')

        const Order = (await import('#models/order')).default
        const Rating = (await import('#models/rating')).default

        // 1. Total Missions
        const totalResult = await Order.query()
            .where('driverId', driverId)
            .count('* as total')
            .first()
        const totalMissions = Number(totalResult?.$extras.total || 0)

        // 2. Success Rate
        const finishedOrders = await Order.query()
            .where('driverId', driverId)
            .whereIn('status', ['DELIVERED', 'FAILED', 'CANCELLED'])
            .select('status')

        const deliveredCount = finishedOrders.filter(o => o.status === 'DELIVERED').length
        const successRate = finishedOrders.length > 0
            ? (deliveredCount / finishedOrders.length) * 100
            : 100

        // 3. Monthly Revenue (Current Month)
        const startOfMonth = DateTime.now().startOf('month')
        const deliveredThisMonth = await Order.query()
            .where('driverId', driverId)
            .where('status', 'DELIVERED')
            .where('completedAt', '>=', startOfMonth.toSQL()!)

        let monthlyRevenue = 0
        deliveredThisMonth.forEach(o => {
            // Priority to driverRemuneration, fallback to calculatedAmount or 0
            const amount = o.pricingData?.driverRemuneration || o.pricingData?.calculatedAmount || (o as any).pricingData?.amount || 0
            monthlyRevenue += Number(amount)
        })

        // 4. Excellence Score
        const ratingsResult = await Rating.query()
            .where('toId', driverId)
            .avg('score as avgScore')
            .first()

        const excellenceScore = Number(ratingsResult?.$extras.avgScore || 5.0)

        return {
            totalMissions,
            successRate: Number(successRate.toFixed(1)),
            monthlyRevenue,
            excellenceScore: Number(excellenceScore.toFixed(2))
        }
    }
}
