import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import Booking from '#models/booking'
import Stop from '#models/stop'
import User from '#models/user'
import {type BelongsTo } from '@adonisjs/lucid/types/relations'

export default class PaymentIntent extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(intent: PaymentIntent) {
        if (!intent.id) {
            intent.id = generateId('pi')
        }
    }

    @column()
    declare orderId: string

    @belongsTo(() => Order)
    declare order: BelongsTo<typeof Order>

    @column()
    declare bookingId: string | null

    @belongsTo(() => Booking)
    declare booking: BelongsTo<typeof Booking>

    @column()
    declare stopId: string | null

    @belongsTo(() => Stop)
    declare stop: BelongsTo<typeof Stop>

    @column()
    declare payerId: string

    @belongsTo(() => User, { foreignKey: 'payerId' })
    declare payer: BelongsTo<typeof User>

    @column()
    declare amount: number

    @column()
    declare calculatedAmount: number

    @column()
    declare isPriceOverridden: boolean

    @column()
    declare paymentMethod: 'CASH' | 'WAVE' | 'WALLET'

    @column()
    declare status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED'

    @column()
    declare externalId: string | null

    @column()
    declare platformFee: number

    @column()
    declare waveFee: number

    @column()
    declare companyAmount: number

    @column()
    declare driverAmount: number

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
