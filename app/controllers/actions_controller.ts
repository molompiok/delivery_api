import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import ActionService from '#services/order/action_service'

@inject()
export default class ActionsController {
    constructor(protected actionService: ActionService) { }

    async store({ params, request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const payload = request.all()
        const result = await this.actionService.addAction(params.stopId, user.id, payload)
        return response.created(result)
    }

    async update({ params, request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const payload = request.all()
        const result = await this.actionService.updateAction(params.id, user.id, payload)
        return response.ok(result)
    }

    async destroy({ params, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const result = await this.actionService.removeAction(params.id, user.id)
        return response.ok(result)
    }
}
