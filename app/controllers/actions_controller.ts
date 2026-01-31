import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order_service'
import vine from '@vinejs/vine'

const updateActionValidator = vine.compile(
    vine.object({
        type: vine.enum(['pickup', 'delivery', 'service'] as const).optional(),
        quantity: vine.number().min(0).optional(),
        transit_item_id: vine.string().trim().optional(),
        service_time: vine.number().min(0).optional(),
        confirmation_rules: vine.object({
            otp: vine.boolean().optional(),
            photo: vine.boolean().optional(),
            signature: vine.boolean().optional(),
            scan: vine.boolean().optional(),
        }).optional(),
        metadata: vine.any().optional(),
    })
)

const addActionValidator = vine.compile(
    vine.object({
        type: vine.enum(['pickup', 'delivery', 'service'] as const),
        quantity: vine.number().min(0).optional(),
        transit_item_id: vine.string().trim().optional(),
        service_time: vine.number().optional(),
        metadata: vine.any().optional(),
    })
)

@inject()
export default class ActionsController {
    constructor(protected orderService: OrderService) { }

    async store({ params, request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const payload = await request.validateUsing(addActionValidator)
        const action = await this.orderService.addAction(params.stopId, user.id, payload)
        return response.created(action)
    }

    async update({ params, request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const payload = await request.validateUsing(updateActionValidator)
        const action = await this.orderService.updateAction(params.id, user.id, payload)
        return response.ok(action)
    }

    async destroy({ params, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        await this.orderService.removeAction(params.id, user.id)
        return response.noContent()
    }
}
