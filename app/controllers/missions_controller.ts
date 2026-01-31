import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import MissionService from '#services/mission_service'
import vine from '@vinejs/vine'

const verifyCodeValidator = vine.compile(
    vine.object({
        code: vine.string().trim().minLength(6).maxLength(6),
    })
)

@inject()
export default class MissionsController {
    constructor(protected missionService: MissionService) { }

    /**
     * Driver signals arrival at a stop
     */
    async arrivedAtStop({ response, params, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const stop = await this.missionService.arrivedAtStop(user.id, params.stopId)
            return response.ok({
                message: 'Arrived at stop',
                stop: stop.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async completeAction(ctx: HttpContext) {
        const { params, auth, response, request } = ctx
        try {
            const user = auth.getUserOrFail()
            const proofs = request.all().proofs || {}

            // Collect and flatten all files from request
            const allFiles = request.allFiles()
            const files = Object.values(allFiles).flat()

            const action = await this.missionService.completeAction(user.id, params.actionId, proofs, files)
            return response.ok({
                message: 'Action completed',
                action: action.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }


    /**
     * Verify a pickup or delivery code
     */
    async verifyCode({ request, response, params, auth }: HttpContext) {
        try {
            auth.getUserOrFail()
            const { code } = await request.validateUsing(verifyCodeValidator)
            const leg = await this.missionService.verifyCode(params.id, code)

            return response.ok({
                message: 'Code verified successfully',
                leg: {
                    id: leg.id,
                    sequence: leg.sequence,
                    status: leg.status,
                },
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Accept a mission
     */
    async accept({ response, params, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const order = await this.missionService.acceptMission(user.id, params.id)
            return response.ok({
                message: 'Mission accepted successfully',
                order: order.serialize(),
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Refuse a mission
     */
    async refuse({ params, auth, response }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            await this.missionService.refuseMission(user.id, params.id)
            return response.ok({ message: 'Mission refused' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Update mission status
     */
    async updateStatus({ request, response, params, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const { status, latitude, longitude, reason } = request.all()
            const order = await this.missionService.updateStatus(params.id, user.id, status, {
                latitude,
                longitude,
                reason,
            })
            return response.ok({
                message: 'Status updated successfully',
                order: order.serialize(),
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List missions for the authenticated driver
     */
    async list({ auth, response }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const missions = await this.missionService.listMissions(user.id)
            return response.ok(missions)
        } catch (error: any) {
            return response.internalServerError({ message: error.message })
        }
    }
}
