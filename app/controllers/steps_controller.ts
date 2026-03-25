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
export default class StepsController {
    constructor(protected orderService: OrderService) { }

    async store({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            const payload = request.all()
            const result = await this.orderService.addStep(params.orderId, user.id, payload, {
                targetCompanyId: getWriteTargetCompanyId(access),
            })
            return response.created({
                step: result.entity,
                validationErrors: result.validationErrors
            })
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            return response.badRequest({ message: error.message })
        }
    }

    async update({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            const payload = request.all()
            const result = await this.orderService.updateStep(params.id, user.id, payload, {
                targetCompanyId: getWriteTargetCompanyId(access),
            })
            return response.ok({
                step: result.entity,
                validationErrors: result.validationErrors
            })
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            if (error.message.includes('not found')) {
                return response.notFound({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    async destroy({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const access = resolveOrderAccessContext(user, getRequestedOrderAccessScope(request))
            assertAllowedOrderAccessScope(access, ['self', 'company'])
            const result = await this.orderService.removeStep(params.id, user.id, {
                targetCompanyId: getWriteTargetCompanyId(access),
            })
            return response.ok(result)
        } catch (error: any) {
            if (error.message?.startsWith('FORBIDDEN:')) {
                return response.forbidden({ message: error.message.replace('FORBIDDEN: ', '') })
            }
            if (error.message.includes('not found')) {
                return response.notFound({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }
}
