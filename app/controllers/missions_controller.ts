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
            console.error('[MissionsController] arrivedAtStop Error:', error.message);
            console.error(error);
            return response.badRequest({ message: error.message })
        }
    }

    async completeStop({ params, auth, response }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const stop = await this.missionService.completeStop(user.id, params.stopId)
            return response.ok({
                message: 'Stop completed',
                stop: stop.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async freezeStop({ params, auth, response, request }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const { reason } = request.all()
            const stop = await this.missionService.freezeStop(user.id, params.stopId, reason)
            return response.ok({
                message: 'Stop frozen',
                stop: stop.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async unfreezeStop({ params, auth, response }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const stop = await this.missionService.unfreezeStop(user.id, params.stopId)
            return response.ok({
                message: 'Stop reactivated',
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

    async freezeAction({ params, auth, response, request }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const { reason } = request.all()
            const action = await this.missionService.freezeAction(user.id, params.actionId, reason)
            return response.ok({
                message: 'Action frozen',
                action: action.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async unfreezeAction({ params, auth, response }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const action = await this.missionService.unfreezeAction(user.id, params.actionId)
            return response.ok({
                message: 'Action reactivated',
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

    async finish({ params, auth, response }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const order = await this.missionService.completeOrder(user.id, params.id)
            return response.ok({
                message: 'Mission finished',
                order: order.serialize()
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
     * Get single mission details
     */
    async show({ params, auth, response }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const mission = await this.missionService.getMission(user.id, params.id)
            return response.ok(mission.serialize())
        } catch (error: any) {
            return response.notFound({ message: 'Mission not found or not authorized' })
        }
    }

    /**
     * List missions for the authenticated driver
     */
    async list({ auth, request, response }: HttpContext) {
        try {
            const user = auth.getUserOrFail()

            // Log Requester Info
            // const DriverSetting = (await import('#models/driver_setting')).default
            // const ds = await DriverSetting.query().where('userId', user.id).preload('currentCompany').first()
            // console.log(`\n[API] 📥 Mission Request from: ${user.fullName} (${user.phone})`)
            // console.log(`      🏢 Working for/Company: ${ds?.currentCompany?.name || 'Indépendant'}`)

            const filter = request.input('filter')
            const page = request.input('page') ? Number(request.input('page')) : 1
            const limit = request.input('limit') ? Number(request.input('limit')) : 20

            const result = await this.missionService.listMissions(user.id, filter, page, limit)
            let missions: any[]
            let meta: any = null

            if (page && limit) {
                missions = (result as any).data
                meta = (result as any).meta
            } else {
                missions = result as any[]
            }

            // Log Missions Summary
            // console.log(`[API] 📤 Sending ${missions.length} Missions:`)
            // missions.forEach((m: any, i) => {
            //     //@ts-ignore
            //     console.log(`      #${i + 1}: ${m.id} | Status: ${m.status} | Client: ${m.client?.fullName} | Company: ${m.client?.company?.name || 'IDEP'}`)
            // })
            // console.log(`\n`)

            if (page && limit) {
                return response.ok({
                    data: missions.map(m => m.serialize()),
                    meta: meta
                })
            }

            return response.ok(missions.map(m => m.serialize()))
        } catch (error: any) {
            return response.internalServerError({ message: error.message })
        }
    }
}
