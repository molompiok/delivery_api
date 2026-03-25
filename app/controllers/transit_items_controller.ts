import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order/index'
import {
    assertAllowedOrderAccessScope,
    getRequestedOrderAccessScope,
    getWriteTargetCompanyId,
    resolveOrderAccessContext,
} from '#utils/order_access'

@inject()
export default class TransitItemsController {
    constructor(protected orderService: OrderService) { }

    /**
     * Update a transit item.
     */
    async update({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            const payload = request.all()
            const result = await this.orderService.updateTransitItem(params.id, user.id, payload, {
                targetCompanyId: getWriteTargetCompanyId(access),
            })
            return response.ok(result)
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }
}
