import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import ZoneService from '#services/zone_service'

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
        try {
            const { user, companyId } = await this.getContext(auth)
            const zones = await ZoneService.listZones(user, companyId)
            return response.ok(zones)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async store({ request, response, auth }: HttpContext) {
        try {
            const { user, companyId } = await this.getContext(auth)
            const data = await request.validateUsing(zoneValidator)
            const zone = await ZoneService.createZone(user, companyId, data)
            return response.created(zone)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async show({ params, response, auth }: HttpContext) {
        try {
            const { user, companyId } = await this.getContext(auth)
            const zone = await ZoneService.getZone(params.id, user, companyId)
            return response.ok(zone)
        } catch (error: any) {
            return response.notFound({ message: error.message })
        }
    }

    async update({ params, request, response, auth }: HttpContext) {
        try {
            const { user, companyId } = await this.getContext(auth)
            const data = await request.validateUsing(zoneValidator)
            const zone = await ZoneService.updateZone(params.id, user, companyId, data)
            return response.ok(zone)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async destroy({ params, response, auth }: HttpContext) {
        try {
            const { user, companyId } = await this.getContext(auth)
            await ZoneService.deleteZone(params.id, user, companyId)
            return response.noContent()
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Set active zone for a driver in ETP mode
     */
    async setActiveZoneETP({ params, request, response, auth }: HttpContext) {
        try {
            const { companyId } = await this.getContext(auth)
            const { driverId } = request.only(['driverId'])

            if (!companyId) return response.badRequest({ message: 'Company context required' })

            const cds = await ZoneService.setActiveZoneETP(params.id, companyId, driverId)
            return response.ok({
                message: 'Active zone set successfully',
                companyDriverSetting: cds
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Clear active zone for a driver in ETP mode
     */
    async clearActiveZoneETP({ request, response, auth }: HttpContext) {
        try {
            const { companyId } = await this.getContext(auth)
            const { driverId } = request.only(['driverId'])

            if (!companyId) return response.badRequest({ message: 'Company context required' })

            await ZoneService.clearActiveZoneETP(companyId, driverId)
            return response.ok({ message: 'Active zone cleared' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Set active zone for driver in IDEP mode
     */
    async setActiveZoneIDEP({ params, response, auth }: HttpContext) {
        try {
            const { user } = await this.getContext(auth)
            const driverSetting = await ZoneService.setActiveZoneIDEP(params.id, user)
            return response.ok({
                message: 'Active IDEP zone set successfully',
                driverSetting
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Clear active zone for driver in IDEP mode
     */
    async clearActiveZoneIDEP({ response, auth }: HttpContext) {
        try {
            const { user } = await this.getContext(auth)
            await ZoneService.clearActiveZoneIDEP(user)
            return response.ok({ message: 'Active IDEP zone cleared' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Install (copy) a Sublymus zone to the company
     */
    async installFromSublymus({ params, response, auth }: HttpContext) {
        try {
            const { companyId } = await this.getContext(auth)
            if (!companyId) return response.badRequest({ message: 'Company context required' })

            const copy = await ZoneService.installFromSublymus(params.id, companyId)
            return response.created({
                message: 'Zone installed successfully',
                zone: copy
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get drivers who have this zone as their active zone
     */
    async getActiveDrivers({ params, response, auth }: HttpContext) {
        try {
            const { user, companyId } = await this.getContext(auth)
            const result = await ZoneService.getActiveDrivers(params.id, user, companyId)

            return response.ok({
                ...result,
                count: result.drivers.length
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}

