import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import MissionService from '#services/mission_service'
import vine from '@vinejs/vine'
import Mission from '#models/mission'

/**
 * Validates mission status update requests.
 */
const updateMissionStatusValidator = vine.compile(
    vine.object({
        status: vine.enum(['ACCEPTED', 'AT_PICKUP', 'COLLECTED', 'AT_DELIVERY', 'DELIVERED', 'FAILED'] as const),
        latitude: vine.number().optional(),
        longitude: vine.number().optional(),
        reason: vine.string().trim().optional(),
    })
)

@inject()
export default class MissionsController {
    constructor(protected missionService: MissionService) { }

    /**
     * Driver accepts a mission.
     */
    async accept({ params, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        if (!user.isDriver) {
            return response.forbidden({ message: 'Only drivers can accept missions' })
        }

        try {
            const order = await this.missionService.acceptMission(user.id, params.id)
            return response.ok({
                message: 'Mission accepted successfully',
                order: order.serialize()
            })
        } catch (error) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Driver refuses a mission.
     */
    async refuse({ params, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        if (!user.isDriver) {
            return response.forbidden({ message: 'Only drivers can refuse missions' })
        }

        await this.missionService.refuseMission(user.id, params.id)
        return response.ok({ message: 'Mission refused successfully' })
    }

    /**
     * Driver updates mission status.
     */
    async updateStatus({ params, request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        if (!user.isDriver) {
            return response.forbidden({ message: 'Only drivers can update mission statuses' })
        }

        const payload = await request.validateUsing(updateMissionStatusValidator)

        try {
            const order = await this.missionService.updateStatus(params.id, user.id, payload.status, {
                latitude: payload.latitude,
                longitude: payload.longitude,
                reason: payload.reason
            })
            return response.ok({
                message: `Mission status updated to ${payload.status}`,
                order: order.serialize()
            })
        } catch (error) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Show active mission for the driver.
     */
    async show({ response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const activeMission = await (Mission.query() as any)
            .where('driverId', user.id)
            .whereIn('status', ['ASSIGNED', 'IN_PROGRESS'])
            .preload('order', (q: any) => {
                q.preload('legs')
                q.preload('packages')
                q.preload('pickupAddress')
                q.preload('deliveryAddress')
            })
            .first()

        if (!activeMission) {
            return response.notFound({ message: 'No active mission found' })
        }

        return response.ok(activeMission.serialize())
    }
}
