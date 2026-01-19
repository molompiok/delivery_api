import User from '#models/user'
import Company from '#models/company'
import CompanyDriverSetting from '#models/company_driver_setting'
import SmsService from '#services/sms_service'
import { DateTime } from 'luxon'

export class CompanyService {
    /**
     * Create a company
     */
    async create(user: User, data: { name: string, registreCommerce?: string, logo?: string, description?: string }) {
        if (user.companyId) {
            throw new Error('User already owns a company')
        }

        const company = await Company.create({
            ...data,
            ownerId: user.id,
        })

        user.companyId = company.id
        user.currentCompanyManaged = company.id
        await user.save()

        return company
    }

    /**
     * Update company
     */
    async update(user: User, data: { name?: string, registreCommerce?: string, logo?: string, description?: string }) {
        if (!user.companyId) {
            throw new Error('User does not own a company')
        }

        const company = await Company.findOrFail(user.companyId)
        company.merge(data)
        await company.save()

        return company
    }

    /**
     * Invite a driver
     */
    async inviteDriver(user: User, phone: string) {
        if (!user.companyId) {
            throw new Error('User does not own a company')
        }

        // 1. Find or create the driver (placeholder)
        const driver = await User.firstOrCreate({ phone }, {
            isDriver: true,
            isActive: true, // Account is active but phone not verified
            phone: phone, // Ensure phone is set if creating a new user
        })

        // 2. Find or create the relationship
        const relation = await CompanyDriverSetting.updateOrCreate(
            {
                companyId: user.companyId,
                driverId: driver.id,
            },
            {
                status: 'PENDING_ACCESS',
                invitedAt: DateTime.now(),
                acceptedAt: null
            }
        )

        await relation.save()

        // 3. Send SMS notification
        const company = await Company.findOrFail(user.companyId)
        await SmsService.send({
            to: phone,
            content: `Bonjour, l'entreprise ${company.name} souhaite accéder à vos documents sur Sublymus pour un recrutement. Connectez-vous pour accepter la demande.`
        })

        return relation
    }

    /**
     * Remove a driver
     */
    async removeDriver(user: User, driverId: string) {
        if (!user.companyId) {
            throw new Error('User does not own a company')
        }

        const companyDriver = await CompanyDriverSetting.query()
            .where('companyId', user.companyId)
            .where('driverId', driverId)
            .where('status', 'ACCEPTED')
            .firstOrFail()

        companyDriver.status = 'REMOVED'
        await companyDriver.save()

        return true
    }

    /**
     * List drivers
     */
    async listDrivers(user: User, filters: { status?: string, name?: string, email?: string, phone?: string } = {}) {
        if (!user.companyId) {
            throw new Error('User does not own a company')
        }

        const query = CompanyDriverSetting.query()
            .where('companyId', user.companyId)
            .preload('driver', (q) => {
                q.preload('driverSetting')
            })

        // Filter by Status
        if (filters.status) {
            query.where('status', filters.status)
        } else {
            query.whereIn('status', ['ACCEPTED', 'PENDING', 'PENDING_ACCESS', 'ACCESS_ACCEPTED', 'PENDING_FLEET', 'REJECTED'])
        }

        // Filter by Driver Attributes (Name, Email, Phone)
        if (filters.name || filters.email || filters.phone) {
            query.whereHas('driver', (q) => {
                if (filters.name) {
                    q.where('fullName', 'ilike', `%${filters.name}%`)
                }
                if (filters.email) {
                    q.where('email', 'ilike', `%${filters.email}%`)
                }
                if (filters.phone) {
                    q.where('phone', 'ilike', `%${filters.phone}%`)
                }
            })
        }

        return await query
            .orderBy('status', 'asc')
            .orderBy('invitedAt', 'desc')
    }

    /**
     * Get Driver Details
     */
    async getDriverDetails(user: User, driverId: string) {
        if (!user.companyId) {
            throw new Error('User does not own a company')
        }

        // 1. Get Relationship
        const relation = await CompanyDriverSetting.query()
            .where('companyId', user.companyId)
            .where('driverId', driverId)
            .preload('driver', (q) => {
                q.preload('driverSetting')
                q.preload('zones')
            })
            .firstOrFail()

        // 2. Get Assigned Vehicle
        const Vehicle = (await import('#models/vehicle')).default
        const vehicle = await Vehicle.findBy('assignedDriverId', driverId)

        // 3. Get Recent Orders (Mocked/Placeholder for now as Order model might not be linked in pivot)
        let orders: any[] = []
        try {
            const Order = (await import('#models/order')).default
            orders = await Order.query()
                .where('driverId', driverId)
                .preload('pickupAddress')
                .preload('deliveryAddress')
                .orderBy('createdAt', 'desc')
                .limit(5)
        } catch (e) {
            // Order model might not exist or be linked yet
        }

        // 4. Get Assigned Schedules
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
     * Step 3: Select required documents for a driver
     */
    async setRequiredDocs(user: User, driverId: string, docTypeIds: string[]) {
        if (!user.companyId) throw new Error('Company access required')

        const relation = await CompanyDriverSetting.query()
            .where('companyId', user.companyId)
            .where('driverId', driverId)
            .firstOrFail()

        relation.requiredDocTypes = docTypeIds
        await relation.save()

        const Document = (await import('#models/document')).default
        const existingDocs = await Document.query()
            .where('tableName', 'CompanyDriverSetting')
            .where('tableId', relation.id)

        const newTypeKeys = docTypeIds.map(id => id.replace('dct_', ''))

        // 1. Handle Removals
        for (const doc of existingDocs) {
            if (!newTypeKeys.includes(doc.documentType)) {
                const history = doc.metadata?.history || []
                const isDirty = history.length > 0 || doc.fileId !== null

                if (isDirty) {
                    doc.isDeleted = true
                    doc.addHistory('REMOVED_FROM_REQUIREMENTS', user)
                    await doc.save()
                } else {
                    await doc.delete()
                }
            }
        }

        // 2. Handle Additions/Restores
        for (const typeKey of newTypeKeys) {
            const existing = existingDocs.find(d => d.documentType === typeKey)
            if (existing) {
                if (existing.isDeleted) {
                    existing.isDeleted = false
                    existing.status = 'PENDING'
                    existing.addHistory('RESTORED_TO_REQUIREMENTS', user)
                    await existing.save()
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
                })
            }
        }

        await this.syncDocsStatus(relation.id)
        return relation
    }

    /**
     * Re-calculate and sync the global docsStatus for a relation
     */
    async syncDocsStatus(relationId: string) {
        const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
        const relation = await CompanyDriverSetting.findOrFail(relationId)

        const docs = await relation.related('documents').query().where('isDeleted', false)
        const requiredDocTypes = (relation.requiredDocTypes || []).map(t => t.replace('dct_', ''))

        let newStatus: 'APPROVED' | 'PENDING' | 'REJECTED' = 'APPROVED'

        if (requiredDocTypes.length === 0) {
            newStatus = 'APPROVED'
        } else {
            for (const type of requiredDocTypes) {
                const doc = docs.find(d => d.documentType === type)

                if (!doc || doc.status === 'REJECTED') {
                    newStatus = 'REJECTED'
                    break
                }

                if (doc.status === 'PENDING') {
                    newStatus = 'PENDING'
                }
            }
        }

        relation.docsStatus = newStatus
        await relation.save()
        return newStatus
    }

    /**
     * Step 6: Validate an individual document
     */
    async validateDocument(user: User, docId: string, status: 'APPROVED' | 'REJECTED', comment?: string) {
        if (!user.companyId) throw new Error('Company access required')

        const Document = (await import('#models/document')).default
        const doc = await Document.findOrFail(docId)

        // Check if doc belongs to this company's relation
        if (doc.tableName !== 'CompanyDriverSetting' || doc.ownerId !== user.companyId) {
            throw new Error('Not authorized to validate this document')
        }

        doc.status = status as any
        doc.validationComment = comment || null
        doc.addHistory('VALIDATION_UPDATE', user, { status, comment })
        await doc.save()

        // Sync global status
        await this.syncDocsStatus(doc.tableId)

        return doc
    }

    /**
     * Step 7: Send final fleet invitation
     */
    async inviteToFleet(user: User, driverId: string) {
        if (!user.companyId) throw new Error('Company access required')

        const relation = await CompanyDriverSetting.query()
            .where('companyId', user.companyId)
            .where('driverId', driverId)
            .where('status', 'ACCESS_ACCEPTED')
            .firstOrFail()

        // Check if all required docs are APPROVED via Document model
        const requiredTypes = (relation.requiredDocTypes || []).map(t => t.replace('dct_', ''))
        const docs = await relation.related('documents').query()

        for (const type of requiredTypes) {
            const doc = docs.find(d => d.documentType === type)
            if (!doc || doc.status !== 'APPROVED') {
                throw new Error(`Le document "${type}" doit être validé avant l'invitation finale.`)
            }
        }

        relation.status = 'PENDING_FLEET'
        await relation.save()

        // Send Notification (SMS)
        const driver = await User.findOrFail(relation.driverId)
        const company = await Company.findOrFail(user.companyId)
        if (driver.phone) {
            await SmsService.send({
                to: driver.phone,
                content: `Félicitations ! Vos documents ont été validés par ${company.name}. Connectez-vous pour rejoindre officiellement la flotte.`
            })
        }

        return {
            ...relation.serialize(),
            documents: docs.map(d => d.serialize())
        }
    }
}

export default new CompanyService()
