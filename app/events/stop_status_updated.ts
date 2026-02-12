import { BaseEvent } from '@adonisjs/core/events'

export default class StopStatusUpdated extends BaseEvent {
    constructor(public payload: { stopId: string, status: string, orderId: string }) {
        super()
    }
}
