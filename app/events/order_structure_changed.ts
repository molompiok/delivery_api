import { BaseEvent } from '@adonisjs/core/events'

export default class OrderStructureChanged extends BaseEvent {
    constructor(public payload: { orderId: string, clientId: string }) {
        super()
    }
}
