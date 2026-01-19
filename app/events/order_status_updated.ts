import { BaseEvent } from '@adonisjs/core/events'

export default class OrderStatusUpdated extends BaseEvent {
    constructor(public payload: { orderId: string, status: string, clientId: string }) {
        super()
    }
}
