import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order/index'

@inject()
export default class ActionsController {
    constructor(protected orderService: OrderService) { }

    async store({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const payload = request.all()
            const result = await this.orderService.addAction(params.stopId, user.id, payload)
            return response.created({
                action: result.entity,
                validationErrors: result.validationErrors
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async update({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const payload = request.all()
            const result = await this.orderService.updateAction(params.id, user.id, payload)
            return response.ok({
                action: result.entity,
                validationErrors: result.validationErrors
            })
        } catch (error: any) {
            if (error.message.includes('not found')) {
                return response.notFound({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    async destroy({ params, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const result = await this.orderService.removeAction(params.id, user.id)
            return response.ok(result)
        } catch (error: any) {
            if (error.message.includes('not found')) {
                return response.notFound({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }
}
