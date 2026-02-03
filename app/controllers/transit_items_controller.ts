import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order_service'

@inject()
export default class TransitItemsController {
    constructor(protected orderService: OrderService) { }

    /**
     * Update a transit item.
     */
    async update({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const payload = request.all()
            const result = await this.orderService.updateTransitItem(params.id, user.id, payload)
            return response.ok(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
