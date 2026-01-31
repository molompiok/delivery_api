import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import Address from '#models/address'
import Action from '#models/action'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class Stop extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(stop: Stop) {
        stop.id = generateId('stp')
    }

    @column()
    declare orderId: string

    /**
     * ID du Step (groupe) auquel appartient ce stop
     */
    @column()
    declare stepId: string

    @column()
    declare addressId: string

    /**
     * Séquence ordonnée des arrêts
     */
    @column()
    declare sequence: number

    @column()
    declare status: 'PENDING' | 'ARRIVED' | 'COMPLETED' | 'FAILED'

    @column.dateTime()
    declare arrivalTime: DateTime | null

    @column.dateTime()
    declare completionTime: DateTime | null

    @column({
        prepare: (v) => v ? JSON.stringify(v) : JSON.stringify({}),
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare metadata: any

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => Order, { foreignKey: 'orderId' })
    declare order: BelongsTo<typeof Order>

    @belongsTo(() => Address)
    declare address: BelongsTo<typeof Address>

    @hasMany(() => Action)
    declare actions: HasMany<typeof Action>
}
