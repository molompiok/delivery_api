import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order/index'

@inject()
export default class StepsController {
    constructor(protected orderService: OrderService) { }

    async store({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const payload = request.all()
            const result = await this.orderService.addStep(params.orderId, user.id, payload)
            return response.created({
                step: result.entity,
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
            const result = await this.orderService.updateStep(params.id, user.id, payload)
            return response.ok({
                step: result.entity,
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
            const result = await this.orderService.removeStep(params.id, user.id)
            return response.ok(result)
        } catch (error: any) {
            if (error.message.includes('not found')) {
                return response.notFound({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }
}
