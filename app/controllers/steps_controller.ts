import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order_service'
import vine from '@vinejs/vine'

const updateStepValidator = vine.compile(
    vine.object({
        sequence: vine.number().optional(),
        linked: vine.boolean().optional(),
        metadata: vine.any().optional(),
    })
)

@inject()
export default class StepsController {
    constructor(protected orderService: OrderService) { }

    async update({ params, request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const payload = await request.validateUsing(updateStepValidator)
        const step = await this.orderService.updateStep(params.id, user.id, payload)
        return response.ok(step)
    }

    async destroy({ params, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        await this.orderService.removeStep(params.id, user.id)
        return response.noContent()
    }
}
