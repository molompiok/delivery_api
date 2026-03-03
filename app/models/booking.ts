import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import User from '#models/user'
import Stop from '#models/stop'
import TransitItem from '#models/transit_item'
import PaymentIntent from '#models/payment_intent'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class Booking extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(booking: Booking) {
        if (!booking.id) {
            booking.id = generateId('bk')
        }
    }

    @column()
    declare orderId: string

    @belongsTo(() => Order)
    declare order: BelongsTo<typeof Order>

    @column()
    declare clientId: string

    @belongsTo(() => User, { foreignKey: 'clientId' })
    declare client: BelongsTo<typeof User>

    @column()
    declare pickupStopId: string | null

    @belongsTo(() => Stop, { foreignKey: 'pickupStopId' })
    declare pickupStop: BelongsTo<typeof Stop>

    @column()
    declare dropoffStopId: string | null

    @belongsTo(() => Stop, { foreignKey: 'dropoffStopId' })
    declare dropoffStop: BelongsTo<typeof Stop>

    @column({
        prepare: (value: any) => JSON.stringify(value),
        consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value),
    })
    declare seatsReserved: string[] | null

    @column()
    declare status: 'PENDING' | 'CONFIRMED' | 'CANCELLED'

    @hasMany(() => TransitItem)
    declare transitItems: HasMany<typeof TransitItem>

    @hasMany(() => PaymentIntent)
    declare paymentIntents: HasMany<typeof PaymentIntent>

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
