import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import Zone, { ZoneOwnerType } from '#models/zone'
import CompanyDriverSetting from '#models/company_driver_setting'
import DriverSetting from '#models/driver_setting'

const zoneValidator = vine.compile(
    vine.object({
        name: vine.string().trim().minLength(2).optional(),
        color: vine.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/).optional(),
        sector: vine.string().trim().toUpperCase().nullable().optional(),
        type: vine.enum(['circle', 'polygon', 'rectangle']).optional(),
        geometry: vine.object({
            center: vine.object({
                lat: vine.number(),
                lng: vine.number(),
            }).optional(),
            radiusKm: vine.number().optional(),
            paths: vine.array(
                vine.object({
                    lat: vine.number(),
                    lng: vine.number(),
                })
            ).optional(),
            bounds: vine.object({
                north: vine.number(),
                south: vine.number(),
                east: vine.number(),
                west: vine.number(),
            }).optional(),
        }).optional(),
        isActive: vine.boolean().optional(),
        ownerType: vine.enum(['Company', 'User', 'Sublymus']).optional(),
        ownerId: vine.string().nullable().optional(),
    })
)

export default class ZonesController {
    private async getContext(auth: HttpContext['auth']) {
        const user = auth.getUserOrFail()
        const companyId = user.companyId || user.currentCompanyManaged
        return { user, companyId }
    }

    async index({ response, auth }: HttpContext) {
        const { user, companyId } = await this.getContext(auth)

        const query = Zone.query()

        if (user.isAdmin) {
            // Admins see all zones
        } else if (user.isDriver) {
            // Drivers see:
            // 1. Their own zones (ownerType=User, ownerId=user.id)
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
        } else {
            return response.badRequest({ message: 'User not associated with a company or driver' })
        }

        const zones = await query

        return response.ok(zones)
    }

    async store({ request, response, auth }: HttpContext) {
        const { user, companyId } = await this.getContext(auth)
        const data = await request.validateUsing(zoneValidator)

        let ownerType: ZoneOwnerType = 'User'
        let ownerId: string | null = user.id

        // If company manager, default to Company owner unless specified
        if (!user.isDriver && companyId) {
            ownerType = 'Company'
            ownerId = companyId
        }

        // Allow override if provided (e.g. admin creating a zone for a specific entity)
        if (data.ownerType) {
            ownerType = data.ownerType as ZoneOwnerType
            ownerId = data.ownerId ?? null
        }

        // Only admins can create Sublymus zones
        if (ownerType === 'Sublymus' && !user.isAdmin) {
            return response.forbidden({ message: 'Only admins can create Sublymus zones' })
        }

        const zone = await Zone.create({
            ...data,
            ownerType,
            ownerId,
            isActive: data.isActive ?? true
        })

        return response.created(zone)
    }

    async show({ params, response, auth }: HttpContext) {
        const { user, companyId } = await this.getContext(auth)

        const zone = await Zone.query()
            .where('id', params.id)
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

        if (!zone) return response.notFound({ message: 'Zone not found' })
        return response.ok(zone)
    }

    private recursiveMerge(target: any, source: any) {
        for (const key in source) {
            if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                target[key] = this.recursiveMerge(target[key] || {}, source[key])
            } else {
                target[key] = source[key]
            }
        }
        return target
    }

    async update({ params, request, response, auth }: HttpContext) {
        const { user, companyId } = await this.getContext(auth)
        const zone = await Zone.query()
            .where('id', params.id)
            .where((q) => {
                if (user.isAdmin) {
                    // Admin can update any zone
                    return
                }
                if (companyId) q.where('ownerId', companyId).where('ownerType', 'Company')
                q.orWhere('ownerId', user.id).where('ownerType', 'User')
            })
            .first()

        if (!zone) return response.notFound({ message: 'Zone not found' })

        const data = await request.validateUsing(zoneValidator)

        if (data.geometry && zone.geometry) {
            data.geometry = this.recursiveMerge({ ...zone.geometry }, data.geometry)
        }

        zone.merge(data)
        await zone.save()

        return response.ok(zone)
    }

    async destroy({ params, response, auth }: HttpContext) {
        const { user, companyId } = await this.getContext(auth)
        const zone = await Zone.query()
            .where('id', params.id)
            .where((q) => {
                if (user.isAdmin) {
                    // Admin can delete any zone
                    return
                }
                if (companyId) q.where('ownerId', companyId).where('ownerType', 'Company')
                q.orWhere('ownerId', user.id).where('ownerType', 'User')
            })
            .first()

        if (!zone) return response.notFound({ message: 'Zone not found' })

        await zone.delete()
        return response.noContent()
    }

    /**
     * Set active zone for a driver in ETP mode
     * Updates CompanyDriverSetting.activeZoneId
     */
    async setActiveZoneETP({ params, request, response, auth }: HttpContext) {
        const { companyId } = await this.getContext(auth)
        const { driverId } = request.only(['driverId'])

        if (!companyId) {
            return response.badRequest({ message: 'Company context required' })
        }

        const zone = await Zone.query()
            .where('id', params.id)
            .where('ownerId', companyId)
            .where('ownerType', 'Company')
            .first()

        if (!zone) return response.notFound({ message: 'Company Zone not found' })

        // Verify driver belongs to this company (any status)
        const cds = await CompanyDriverSetting.query()
            .where('companyId', companyId)
            .where('driverId', driverId)
            .first()

        if (!cds) {
            return response.forbidden({ message: 'Driver does not belong to your company' })
        }

        // Set active zone
        cds.activeZoneId = zone.id
        await cds.save()

        return response.ok({
            message: 'Active zone set successfully',
            companyDriverSetting: cds
        })
    }

    /**
     * Clear active zone for a driver in ETP mode
     */
    async clearActiveZoneETP({ request, response, auth }: HttpContext) {
        const { companyId } = await this.getContext(auth)
        const { driverId } = request.only(['driverId'])

        if (!companyId) {
            return response.badRequest({ message: 'Company context required' })
        }

        const cds = await CompanyDriverSetting.query()
            .where('companyId', companyId)
            .where('driverId', driverId)
            .first()

        if (!cds) {
            return response.notFound({ message: 'Driver not found in company' })
        }

        cds.activeZoneId = null
        await cds.save()

        return response.ok({ message: 'Active zone cleared' })
    }

    /**
     * Set active zone for driver in IDEP mode
     * Driver sets their own active zone
     */
    async setActiveZoneIDEP({ params, response, auth }: HttpContext) {
        const { user } = await this.getContext(auth)

        if (!user.isDriver) {
            return response.forbidden({ message: 'Only drivers can set IDEP active zone' })
        }

        // Verify zone belongs to user
        const zone = await Zone.query()
            .where('id', params.id)
            .where((q) => {
                q.where('ownerId', user.id).where('ownerType', 'User')
                q.orWhere('ownerType', 'Sublymus')  // Can also select Sublymus zones
            })
            .first()

        if (!zone) return response.notFound({ message: 'Zone not found or not accessible' })

        // Update DriverSetting
        const driverSetting = await DriverSetting.findByOrFail('userId', user.id)
        driverSetting.activeZoneId = zone.id
        await driverSetting.save()

        return response.ok({
            message: 'Active IDEP zone set successfully',
            driverSetting
        })
    }

    /**
     * Clear active zone for driver in IDEP mode
     */
    async clearActiveZoneIDEP({ response, auth }: HttpContext) {
        const { user } = await this.getContext(auth)

        if (!user.isDriver) {
            return response.forbidden({ message: 'Only drivers can clear IDEP active zone' })
        }

        const driverSetting = await DriverSetting.findByOrFail('userId', user.id)
        driverSetting.activeZoneId = null
        await driverSetting.save()

        return response.ok({ message: 'Active IDEP zone cleared' })
    }

    /**
     * Install (copy) a Sublymus zone to the company
     * Only for Company managers - creates a copy they can customize
     */
    async installFromSublymus({ params, response, auth }: HttpContext) {
        const { companyId } = await this.getContext(auth)

        if (!companyId) {
            return response.badRequest({ message: 'Company context required' })
        }

        // Verify source zone is Sublymus
        const sourceZone = await Zone.query()
            .where('id', params.id)
            .where('ownerType', 'Sublymus')
            .first()

        if (!sourceZone) {
            return response.notFound({ message: 'Sublymus zone not found' })
        }

        // Check if already installed
        const existing = await Zone.query()
            .where('sourceZoneId', sourceZone.id)
            .where('ownerType', 'Company')
            .where('ownerId', companyId)
            .first()

        if (existing) {
            return response.badRequest({
                message: 'Zone already installed',
                existingZone: existing
            })
        }

        // Create copy
        const copy = await Zone.installFromSublymus(sourceZone.id, 'Company', companyId)

        return response.created({
            message: 'Zone installed successfully',
            zone: copy,
            sourceZone: sourceZone
        })
    }

    /**
     * Get drivers who have this zone as their active zone
     */
    async getActiveDrivers({ params, response, auth }: HttpContext) {
        const { user, companyId } = await this.getContext(auth)

        const zone = await Zone.query()
            .where('id', params.id)
            .where((q) => {
                if (user.isAdmin) return // Admin sees all

                // Sublymus zones visible to all
                q.where('ownerType', 'Sublymus')
                // Own zones
                q.orWhere((sq) => sq.where('ownerId', user.id).where('ownerType', 'User'))
                // Company zones
                if (companyId) {
                    q.orWhere((sq) => sq.where('ownerId', companyId).where('ownerType', 'Company'))
                }
            })
            .first()

        if (!zone) {
            return response.notFound({ message: 'Zone not found' })
        }

        const drivers = await zone.getActiveDrivers()

        return response.ok({
            zone: {
                id: zone.id,
                name: zone.name,
                ownerType: zone.ownerType
            },
            activeDrivers: drivers.map(d => ({
                id: d.id,
                fullName: d.fullName,
                phone: d.phone,
                email: d.email
            })),
            count: drivers.length
        })
    }
}

