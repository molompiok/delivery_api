import { BaseEvent } from '@adonisjs/core/events'

export default class ActionStatusUpdated extends BaseEvent {
    constructor(public payload: { actionId: string, status: string, orderId: string }) {
        super()
    }
}
