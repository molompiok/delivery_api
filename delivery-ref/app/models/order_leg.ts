import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import Address from '#models/address'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class OrderLeg extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(leg: OrderLeg) {
        leg.id = generateId('leg')
    }

    @column()
    declare orderId: string

    @column()
    declare sequence: number

    @column()
    declare startAddressId: string | null

    @column()
    declare endAddressId: string | null

    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : null,
    })
    declare startCoordinates: { type: 'Point'; coordinates: [number, number] } | null

    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : null,
    })
    declare endCoordinates: { type: 'Point'; coordinates: [number, number] } | null

    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : null,
    })
    declare geometry: { type: 'LineString'; coordinates: number[][] } | null

    @column()
    declare durationSeconds: number | null

    @column()
    declare distanceMeters: number | null

    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : null,
    })
    declare maneuvers: any[] | null

    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : null,
    })
    declare rawData: any | null

    @column()
    declare verificationCode: string | null

    @column()
    declare isVerified: boolean

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => Order)
    declare order: BelongsTo<typeof Order>

    @belongsTo(() => Address, { foreignKey: 'startAddressId' })
    declare startAddress: BelongsTo<typeof Address>

    @belongsTo(() => Address, { foreignKey: 'endAddressId' })
    declare endAddress: BelongsTo<typeof Address>
}
