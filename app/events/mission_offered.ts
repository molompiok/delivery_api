import { BaseEvent } from '@adonisjs/core/events'

export default class MissionOffered extends BaseEvent {
    constructor(public payload: { orderId: string, driverId: string, expiresAt: string }) {
        super()
    }
}
