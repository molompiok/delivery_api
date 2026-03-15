import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, hasOne, computed, hasMany } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import Vehicle from '#models/vehicle'
import OrderLeg from '#models/order_leg'
import Step from '#models/step'
import Stop from '#models/stop'
import Action from '#models/action'
import TransitItem from '#models/transit_item'
import Company from '#models/company'
import Booking from '#models/booking'
import PaymentIntent from '#models/payment_intent'
import type { BelongsTo, HasOne, HasMany } from '@adonisjs/lucid/types/relations'
import type { PricingDetails, OrderMetadata } from '../types/logistics.js'
import type { OrderTemplate } from '#constants/order_templates'

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
    declare status: 'DRAFT' | 'PENDING' | 'ACCEPTED' | 'DELIVERED' | 'FAILED' | 'CANCELLED' | 'NO_DRIVER_AVAILABLE' | 'PUBLISHED'

    @column()
    declare isComplex: boolean

    @column()
    declare logicPattern: string | null

    @column()
    declare template: OrderTemplate | null

    @column()
    declare isIntervention: boolean

    @column()
    declare initiatorId: string | null

    @column()
    declare paymentTrigger: 'BEFORE_START' | 'ON_DELIVERY' | 'PROGRESSIVE' | 'ON_ACCEPT' | null

    @column()
    declare isDeleted: boolean

    @column()
    declare hasPendingChanges: boolean

    @column({
        prepare: (value: PricingDetails) => value ? JSON.stringify(value) : JSON.stringify({}),
        consume: (value: any) => typeof value === 'string' ? JSON.parse(value) : value
    })
    declare pricingData: PricingDetails

    @column()
    declare calculationEngine: string | null

    @column()
    declare totalDistanceMeters: number | null

    @column()
    declare totalDurationSeconds: number | null

    @column({
        serializeAs: 'routeGeometry',
        prepare: (v: any) => v ? JSON.stringify(v) : null,
        consume: (v: any) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare routeGeometry: { type: 'LineString'; coordinates: number[][] } | null

    @column({
        serializeAs: 'statusHistory',
        prepare: (v: any) => v ? JSON.stringify(v) : JSON.stringify([]),
        consume: (v: any) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare statusHistory: Array<{ status: string; timestamp: string; note?: string }>

    @column({
        prepare: (v: OrderMetadata) => v ? JSON.stringify(v) : JSON.stringify({}),
        consume: (v: any) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare metadata: OrderMetadata


    @column.dateTime()
    declare completedAt: DateTime | null

    @belongsTo(() => User, { foreignKey: 'clientId' })
    declare client: BelongsTo<typeof User>

    @belongsTo(() => Vehicle)
    declare vehicle: BelongsTo<typeof Vehicle>

    @column()
    declare companyId: string | null

    @belongsTo(() => Company)
    declare company: BelongsTo<typeof Company>


    @column()
    declare legId: string | null

    @hasOne(() => OrderLeg)
    declare leg: HasOne<typeof OrderLeg>

    @hasMany(() => Step)
    declare steps: HasMany<typeof Step>

    @hasMany(() => Stop)
    declare stops: HasMany<typeof Stop>

    @hasMany(() => Action)
    declare actions: HasMany<typeof Action>

    @hasMany(() => TransitItem)
    declare transitItems: HasMany<typeof TransitItem>

    @hasMany(() => Booking)
    declare bookings: HasMany<typeof Booking>

    @hasMany(() => PaymentIntent)
    declare paymentIntents: HasMany<typeof PaymentIntent>

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @computed({ serializeAs: 'amountPaid' })
    public get amountPaid(): number {
        if (!this.paymentIntents) return 0
        return this.paymentIntents
            .filter(i => i.status === 'COMPLETED')
            .reduce((sum, i) => sum + (i.amount || 0), 0)
    }

    @computed({ serializeAs: 'paymentStatus' })
    public get paymentStatus(): 'PAID' | 'PARTIAL' | 'UNPAID' {
        const total = this.pricingData?.clientFee || 0
        const paid = this.amountPaid

        if (paid <= 0) return 'UNPAID'
        if (paid >= total) return 'PAID'
        return 'PARTIAL'
    }
}
