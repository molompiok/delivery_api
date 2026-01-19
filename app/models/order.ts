import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, hasOne } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import Package from '#models/package'
import Mission from '#models/mission'
import Address from '#models/address'
import Vehicle from '#models/vehicle'
import OrderLeg from '#models/order_leg'
import type { BelongsTo, HasOne, HasMany } from '@adonisjs/lucid/types/relations'
import { hasMany } from '@adonisjs/lucid/orm'
import type { PricingDetails, WaypointSummaryItem } from '../types/logistics.js'

export default class Order extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(order: Order) {
        order.id = generateId('ord')
    }

    @column()
    declare clientId: string

    @column()
    declare driverId: string | null

    @belongsTo(() => User, { foreignKey: 'driverId' })
    declare driver: BelongsTo<typeof User>

    @column()
    declare vehicleId: string | null

    @column()
    declare refId: string | null

    @column()
    declare assignmentMode: 'GLOBAL' | 'INTERNAL' | 'TARGET'

    @column()
    declare offeredDriverId: string | null

    @column.dateTime()
    declare offerExpiresAt: DateTime | null

    @column()
    declare status: 'PENDING' | 'ACCEPTED' | 'AT_PICKUP' | 'COLLECTED' | 'AT_DELIVERY' | 'DELIVERED' | 'FAILED' | 'CANCELLED'

    @column({
        prepare: (value: PricingDetails) => value ? JSON.stringify(value) : JSON.stringify({}),
    })
    declare pricingData: PricingDetails

    @column()
    declare packageId: string | null

    @column()
    declare pickupAddressId: string

    @column()
    declare deliveryAddressId: string

    @column()
    declare calculationEngine: string | null

    @column({
        prepare: (value: WaypointSummaryItem[]) => value ? JSON.stringify(value) : null,
    })
    declare waypointsSummary: WaypointSummaryItem[] | null

    @column()
    declare totalDistanceMeters: number | null

    @column()
    declare totalDurationSeconds: number | null

    @belongsTo(() => User, { foreignKey: 'clientId' })
    declare client: BelongsTo<typeof User>

    @belongsTo(() => Address, { foreignKey: 'pickupAddressId' })
    declare pickupAddress: BelongsTo<typeof Address>

    @belongsTo(() => Address, { foreignKey: 'deliveryAddressId' })
    declare deliveryAddress: BelongsTo<typeof Address>

    @belongsTo(() => Vehicle)
    declare vehicle: BelongsTo<typeof Vehicle>

    @hasMany(() => Package)
    declare packages: HasMany<typeof Package>

    @hasOne(() => Mission)
    declare mission: HasOne<typeof Mission>

    @hasMany(() => OrderLeg)
    declare legs: HasMany<typeof OrderLeg>

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
