import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import MissionService from '#services/mission_service'
import vine from '@vinejs/vine'
import OrderLeg from '#models/order_leg'
import { isValidCodeFormat } from '#utils/verification_code'

const verifyCodeValidator = vine.compile(
    vine.object({
        code: vine.string().trim().minLength(6).maxLength(6),
    })
)

@inject()
export default class MissionsController {
    constructor(protected missionService: MissionService) { }

    /**
     * Verify a pickup or delivery code
     */
    async verifyCode({ request, response, params, auth }: HttpContext) {
        auth.getUserOrFail()
        const orderId = params.id
        const { code } = await request.validateUsing(verifyCodeValidator)

        try {
            // Validate code format
            if (!isValidCodeFormat(code)) {
                return response.badRequest({
                    message: 'Invalid code format. Must be 6 digits.',
                })
            }

            // Find the leg with this code for this order
            const leg = await OrderLeg.query()
                .where('orderId', orderId)
                .where('verificationCode', code)
                .where('isVerified', false)
                .first()

            if (!leg) {
                return response.badRequest({
                    message: 'Invalid or already used verification code',
                })
            }

            // Mark as verified
            leg.isVerified = true
            await leg.save()

            return response.ok({
                message: 'Code verified successfully',
                leg: {
                    id: leg.id,
                    sequence: leg.sequence,
                    isVerified: leg.isVerified,
                },
            })
        } catch (error) {
            return response.internalServerError({
                message: 'Code verification failed',
                error: error.message,
            })
        }
    }

    /**
     * Accept a mission
     */
    async accept({ response, params, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const orderId = params.id

        try {
            const order = await this.missionService.acceptMission(user.id, orderId)
            return response.ok({
                message: 'Mission accepted successfully',
                order: order.serialize(),
            })
        } catch (error) {
            return response.badRequest({
                message: error.message,
            })
        }
    }

    /**
     * Refuse a mission
     */
    async refuse({ params, auth, response }: HttpContext) {
        const user = auth.getUserOrFail()
        const orderId = params.id

        try {
            await this.missionService.refuseMission(user.id, orderId)
            return response.ok({
                message: 'Mission refused',
            })
        } catch (error) {
            return response.badRequest({
                message: error.message,
            })
        }
    }

    /**
     * Update mission status
     */
    async updateStatus({ request, response, params, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const orderId = params.id
        const { status, latitude, longitude, reason } = request.all()

        try {
            const order = await this.missionService.updateStatus(orderId, user.id, status, {
                latitude,
                longitude,
                reason,
            })
            return response.ok({
                message: 'Status updated successfully',
                order: order.serialize(),
            })
        } catch (error) {
            return response.badRequest({
                message: error.message,
            })
        }
    }

    /**
     * List missions for the authenticated driver
     */
    async list({ auth, response }: HttpContext) {
        const user = auth.getUserOrFail()
        const Order = (await import('#models/order')).default

        try {
            const missions = await Order.query()
                .where('driverId', user.id)
                .orWhere('offeredDriverId', user.id)
                .preload('pickupAddress')
                .preload('deliveryAddress')
                .preload('packages')
                .orderBy('createdAt', 'desc')

            return response.ok(missions)
        } catch (error) {
            return response.internalServerError({
                message: 'Failed to fetch missions',
                error: error.message,
            })
        }
    }
}
