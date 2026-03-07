import Zone, { ZoneOwnerType } from '#models/zone'
import db from '@adonisjs/lucid/services/db'
import CompanyDriverSetting from '#models/company_driver_setting'
import DriverSetting from '#models/driver_setting'
import User from '#models/user'
import DriverRelationNotifyService from '#services/driver_relation_notify_service'

export default class ZoneService {
    /**
     * Get zones based on user context (Admin, Driver, or Manager)
     */
    static async listZones(user: User, companyId: string | null, filters: { ownerType?: ZoneOwnerType } = {}) {
        const query = Zone.query()

        if (filters.ownerType) {
            query.where('ownerType', filters.ownerType)
            if (filters.ownerType === 'Company' && companyId) {
                query.where('ownerId', companyId)
            } else if (filters.ownerType === 'User') {
                query.where('ownerId', user.id)
            }
        } else if (user.isAdmin) {
            // Admins see all zones
        } else if (user.isDriver) {
            // Drivers see:
            // 1. Their own zones
            // 2. Company zones where they work
            // 3. Sublymus global zones
            query.where((q) => {
                q.where('ownerType', 'User').where('ownerId', user.id)
                q.orWhere('ownerType', 'Sublymus')
                if (companyId) {
                    q.orWhere((sq) => {
                        sq.where('ownerType', 'Company').where('ownerId', companyId)
                    })
                }
            })
        } else if (companyId) {
            // Company managers see company-owned zones + Sublymus zones
            query.where((q) => {
                q.where('ownerType', 'Company').where('ownerId', companyId)
                q.orWhere('ownerType', 'Sublymus')
            })
        }

        // Always sort by ownerType (Company first) and then name
        query.orderByRaw("CASE WHEN owner_type = 'Company' THEN 0 WHEN owner_type = 'User' THEN 1 ELSE 2 END")
        query.orderBy('name', 'asc')

        return await query
    }

    /**
     * Create a new zone
     */
    static async createZone(user: User, companyId: string | null, data: any) {
        const trx = await db.transaction()
        try {
            let ownerType: ZoneOwnerType = 'User'
            let ownerId: string | null = user.id

            // If companyId is provided, we default to Company ownership
            // This covers the case where a manager is also a driver
            if (companyId) {
                ownerType = 'Company'
                ownerId = companyId
            }

            // Allow explicit override from data if provided
            if (data.ownerType) {
                ownerType = data.ownerType as ZoneOwnerType
                ownerId = data.ownerId ?? ownerId
            }

            // Only admins can create Sublymus zones
            if (ownerType === 'Sublymus' && !user.isAdmin) {
                throw new Error('Only admins can create Sublymus zones')
            }

            const zone = await Zone.create({
                ...data,
                ownerType,
                ownerId,
                isActive: data.isActive ?? true
            }, { client: trx })

            await trx.commit()
            return zone
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Get a single zone with accessibility check
     */
    static async getZone(id: string, user: User, companyId: string | null) {
        const zone = await Zone.query()
            .where('id', id)
            .where((q) => {
                // Sublymus zones are visible to all
                q.where('ownerType', 'Sublymus')
                // Or user's own zone
                q.orWhere((sq) => sq.where('ownerId', user.id).where('ownerType', 'User'))
                // Or company zone
                if (companyId) {
                    q.orWhere((sq) => sq.where('ownerId', companyId).where('ownerType', 'Company'))
                }
            })
            .first()

        if (!zone) throw new Error('Zone not found')
        return zone
    }

    /**
     * Update a zone
     */
    static async updateZone(id: string, user: User, companyId: string | null, data: any) {
        const trx = await db.transaction()
        try {
            const zone = await Zone.query({ client: trx })
                .where('id', id)
                .where((q) => {
                    if (user.isAdmin) return
                    if (companyId) q.where('ownerId', companyId).where('ownerType', 'Company')
                    q.orWhere('ownerId', user.id).where('ownerType', 'User')
                })
                .forUpdate()
                .first()

            if (!zone) throw new Error('Zone not found')

            if (data.geometry && zone.geometry) {
                data.geometry = this.recursiveMerge({ ...zone.geometry }, data.geometry)
            }

            zone.merge(data)
            await zone.useTransaction(trx).save()
            await trx.commit()

            return zone
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Delete a zone
     */
    static async deleteZone(id: string, user: User, companyId: string | null) {
        const trx = await db.transaction()
        try {
            const zone = await Zone.query({ client: trx })
                .where('id', id)
                .where((q) => {
                    if (user.isAdmin) return
                    if (companyId) q.where('ownerId', companyId).where('ownerType', 'Company')
                    q.orWhere('ownerId', user.id).where('ownerType', 'User')
                })
                .forUpdate()
                .first()

            if (!zone) throw new Error('Zone not found')

            await zone.useTransaction(trx).delete()
            await trx.commit()
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Set active zone for a driver in ETP mode
     */
    static async setActiveZoneETP(zoneId: string, companyId: string, driverId: string) {
        const trx = await db.transaction()
        try {
            const zone = await Zone.query({ client: trx })
                .where('id', zoneId)
                .where((q) => {
                    // Zone must belong to the company
                    q.where('ownerType', 'Company').where('ownerId', companyId)
                    // OR be a User/Sublymus zone that is accessible (we trust the ID here as it was found in the manager's list)
                    q.orWhere('ownerType', 'User')
                    q.orWhere('ownerType', 'Sublymus')
                })
                .first()

            if (!zone) throw new Error('Zone not found or not accessible for assignment')

            const cds = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', companyId)
                .where('driverId', driverId)
                .forUpdate()
                .first()

            if (!cds) throw new Error('Driver does not belong to your company')

            cds.activeZoneId = zone.id
            await cds.useTransaction(trx).save()
            await trx.commit()

            await DriverRelationNotifyService.dispatch({
                scope: 'ASSIGNMENT',
                action: 'ZONE_ASSIGNED',
                message: `Zone active assignee: ${zone.name}.`,
                relationId: cds.id,
                driverId: cds.driverId,
                companyId: cds.companyId,
                entity: {
                    zoneId: zone.id,
                    zoneName: zone.name,
                },
                push: {
                    title: 'Zone assignee',
                    body: `Votre zone active est maintenant ${zone.name}.`,
                    type: 'DRIVER_ZONE_ASSIGNED',
                },
            })

            return cds
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Clear active zone for a driver in ETP mode
     */
    static async clearActiveZoneETP(companyId: string, driverId: string) {
        const trx = await db.transaction()
        try {
            const cds = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', companyId)
                .where('driverId', driverId)
                .forUpdate()
                .first()

            if (!cds) throw new Error('Driver not found in company')

            const previousZoneId = cds.activeZoneId
            let previousZoneName: string | null = null
            if (previousZoneId) {
                const zone = await Zone.find(previousZoneId, { client: trx })
                previousZoneName = zone?.name || null
            }

            cds.activeZoneId = null
            await cds.useTransaction(trx).save()
            await trx.commit()

            await DriverRelationNotifyService.dispatch({
                scope: 'ASSIGNMENT',
                action: 'ZONE_UNASSIGNED',
                message: 'Votre zone active a ete retiree.',
                relationId: cds.id,
                driverId: cds.driverId,
                companyId: cds.companyId,
                entity: {
                    previousZoneId,
                    previousZoneName,
                },
                push: {
                    title: 'Zone retiree',
                    body: 'Votre zone active a ete retiree.',
                    type: 'DRIVER_ZONE_UNASSIGNED',
                },
            })
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Set active zone for driver in IDEP mode
     */
    static async setActiveZoneIDEP(zoneId: string, user: User) {
        const trx = await db.transaction()
        try {
            if (!user.isDriver) throw new Error('Only drivers can set IDEP active zone')

            const zone = await Zone.query({ client: trx })
                .where('id', zoneId)
                .where((q) => {
                    q.where('ownerId', user.id).where('ownerType', 'User')
                    q.orWhere('ownerType', 'Sublymus')
                })
                .first()

            if (!zone) throw new Error('Zone not found or not accessible')

            const driverSetting = await DriverSetting.query({ client: trx })
                .where('userId', user.id)
                .forUpdate()
                .firstOrFail()

            driverSetting.activeZoneId = zone.id
            await driverSetting.useTransaction(trx).save()
            await trx.commit()

            return driverSetting
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Clear active zone for driver in IDEP mode
     */
    static async clearActiveZoneIDEP(user: User) {
        const trx = await db.transaction()
        try {
            if (!user.isDriver) throw new Error('Only drivers can clear IDEP active zone')

            const driverSetting = await DriverSetting.query({ client: trx })
                .where('userId', user.id)
                .forUpdate()
                .firstOrFail()

            driverSetting.activeZoneId = null
            await driverSetting.useTransaction(trx).save()
            await trx.commit()
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Install a Sublymus zone to a company
     */
    static async installFromSublymus(zoneId: string, companyId: string) {
        const trx = await db.transaction()
        try {
            const sourceZone = await Zone.query({ client: trx })
                .where('id', zoneId)
                .where('ownerType', 'Sublymus')
                .first()

            if (!sourceZone) throw new Error('Sublymus zone not found')

            const existing = await Zone.query({ client: trx })
                .where('sourceZoneId', sourceZone.id)
                .where('ownerType', 'Company')
                .where('ownerId', companyId)
                .first()

            if (existing) throw new Error('Zone already installed')

            const newZone = await Zone.installFromSublymus(sourceZone.id, 'Company', companyId)
            await trx.commit()
            return newZone
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Get active drivers in a zone
     */
    static async getActiveDrivers(zoneId: string, user: User, companyId: string | null) {
        const zone = await Zone.query()
            .where('id', zoneId)
            .where((q) => {
                if (user.isAdmin) return
                q.where('ownerType', 'Sublymus')
                q.orWhere((sq) => sq.where('ownerId', user.id).where('ownerType', 'User'))
                if (companyId) {
                    q.orWhere((sq) => sq.where('ownerId', companyId).where('ownerType', 'Company'))
                }
            })
            .first()

        if (!zone) throw new Error('Zone not found')

        const drivers = await zone.getActiveDrivers()
        return {
            zone: {
                id: zone.id,
                name: zone.name,
                ownerType: zone.ownerType
            },
            drivers: drivers.map(d => ({
                id: d.id,
                fullName: d.fullName,
                phone: d.phone,
                email: d.email
            }))
        }
    }

    private static recursiveMerge(target: any, source: any) {
        for (const key in source) {
            if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                target[key] = this.recursiveMerge(target[key] || {}, source[key])
            } else {
                target[key] = source[key]
            }
        }
        return target
    }
}
