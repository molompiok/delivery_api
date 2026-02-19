import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import OrderPayment from '#models/order_payment'
import Stop from '#models/stop'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export type StopPaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'SKIPPED'

export default class StopPayment extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(payment: StopPayment) {
        payment.id = generateId('spay')
    }

    @column()
    declare orderPaymentId: string

    @column()
    declare stopId: string

    @column()
    declare amount: number

    @column()
    declare status: StopPaymentStatus

    @column()
    declare paymentIntentId: string | null

    @column.dateTime()
    declare paidAt: DateTime | null

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => OrderPayment)
    declare orderPayment: BelongsTo<typeof OrderPayment>

    @belongsTo(() => Stop)
    declare stop: BelongsTo<typeof Stop>
}
