import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order_service'
import vine from '@vinejs/vine'

const updateStopValidator = vine.compile(
    vine.object({
        sequence: vine.number().optional(),
        address_text: vine.string().trim().optional(),
        coordinates: vine.array(vine.number()).minLength(2).maxLength(2).optional(),
        metadata: vine.any().optional(),
    })
)

@inject()
export default class StopsController {
    constructor(protected orderService: OrderService) { }

    async update({ params, request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const payload = await request.validateUsing(updateStopValidator)
        const stop = await this.orderService.updateStop(params.id, user.id, payload)
        return response.ok(stop)
    }

    async destroy({ params, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        await this.orderService.removeStop(params.id, user.id)
        return response.noContent()
    }
}
