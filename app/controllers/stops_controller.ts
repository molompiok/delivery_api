import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import StopService from '#services/order/stop_service'

@inject()
export default class StopsController {
    constructor(protected stopService: StopService) { }

    async store({ params, request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const payload = request.all()
        const stop = await this.stopService.addStop(params.stepId, user.id, payload)
        return response.created(stop)
    }

    async update({ params, request, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const payload = request.all()
        const result = await this.stopService.updateStop(params.id, user.id, payload)
        return response.ok(result)
    }

    async destroy({ params, response, auth }: HttpContext) {
        const user = auth.getUserOrFail()
        const result = await this.stopService.removeStop(params.id, user.id)
        return response.ok(result)
    }
}
