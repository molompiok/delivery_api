import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, hasOne } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import Package from '#models/package'
import Mission from '#models/mission'
import Address from '#models/address'
import Vehicle from '#models/vehicle'
import OrderLeg from '#models/order_leg'
import Task from '#models/task'
import Shipment from '#models/shipment'
import Job from '#models/job'
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
    declare priority: 'LOW' | 'MEDIUM' | 'HIGH'

    @column()
    declare assignmentAttemptCount: number

    @column()
    declare status: 'PENDING' | 'ACCEPTED' | 'AT_PICKUP' | 'COLLECTED' | 'AT_DELIVERY' | 'DELIVERED' | 'FAILED' | 'CANCELLED' | 'NO_DRIVER_AVAILABLE'

    @column()
    declare isComplex: boolean

    @column()
    declare logicPattern: string | null

    @column({
        prepare: (value: PricingDetails) => value ? JSON.stringify(value) : JSON.stringify({}),
        consume: (value) => typeof value === 'string' ? JSON.parse(value) : value
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
        consume: (value) => typeof value === 'string' ? JSON.parse(value) : value
    })
    declare waypointsSummary: WaypointSummaryItem[] | null

    @column()
    declare totalDistanceMeters: number | null

    @column()
    declare totalDurationSeconds: number | null

    @column({
        serializeAs: 'routeGeometry',
        prepare: (v) => v ? JSON.stringify(v) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare routeGeometry: { type: 'LineString'; coordinates: number[][] } | null

    @column({
        serializeAs: 'statusHistory',
        prepare: (v) => v ? JSON.stringify(v) : JSON.stringify([]),
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare statusHistory: Array<{ status: string; timestamp: string; note?: string }>

    @column({
        prepare: (v) => v ? JSON.stringify(v) : JSON.stringify({}),
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare metadata: any

    @column.dateTime()
    declare etaPickup: DateTime | null

    @column.dateTime()
    declare etaDelivery: DateTime | null

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

    @hasMany(() => Task)
    declare tasks: HasMany<typeof Task>

    @hasMany(() => Shipment)
    declare shipments: HasMany<typeof Shipment>

    @hasMany(() => Job)
    declare jobs: HasMany<typeof Job>

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
