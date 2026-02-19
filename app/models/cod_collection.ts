import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import OrderPayment from '#models/order_payment'
import Order from '#models/order'
import User from '#models/user'
import Stop from '#models/stop'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export type CodCollectionStatus = 'PENDING' | 'COLLECTED' | 'COD_DEFERRED' | 'SETTLED' | 'DISPUTED'
export type ChangeMethod = 'CASH' | 'WAVE'
export type SettlementMode = 'IMMEDIATE' | 'DEFERRED'

export default class CodCollection extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(cod: CodCollection) {
        cod.id = generateId('cod')
    }

    @column()
    declare orderPaymentId: string

    @column()
    declare orderId: string

    @column()
    declare driverId: string

    @column()
    declare stopId: string | null

    @column()
    declare expectedAmount: number

    @column()
    declare collectedAmount: number

    @column()
    declare changeGiven: number

    @column()
    declare changeMethod: ChangeMethod | null

    @column()
    declare clientWavePhone: string | null

    @column()
    declare settlementMode: SettlementMode

    @column()
    declare deferredReason: string | null

    @column()
    declare status: CodCollectionStatus

    @column.dateTime()
    declare collectedAt: DateTime | null

    @column.dateTime()
    declare settledAt: DateTime | null

    // Preuve
    @column()
    declare proofPhotoUrl: string | null

    @column()
    declare notes: string | null

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => OrderPayment)
    declare orderPayment: BelongsTo<typeof OrderPayment>

    @belongsTo(() => Order)
    declare order: BelongsTo<typeof Order>

    @belongsTo(() => User, { foreignKey: 'driverId' })
    declare driver: BelongsTo<typeof User>

    @belongsTo(() => Stop)
    declare stop: BelongsTo<typeof Stop>
}
