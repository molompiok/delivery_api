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
     * Ordre d'affichage défini par le client dans le dashboard.
     * Ne change JAMAIS par VROOM — uniquement par le client.
     */
    @column()
    declare displayOrder: number

    /**
     * Ordre d'exécution optimisé par VROOM pour la route réelle.
     * null jusqu'au premier calcul VROOM.
     * Quand Step.linked === true, doit refléter displayOrder.
     */
    @column()
    declare executionOrder: number | null

    @column()
    declare status: 'PENDING' | 'ARRIVED' | 'PARTIAL' | 'COMPLETED' | 'FAILED'

    @column.dateTime()
    declare arrivalTime: DateTime | null

    @column.dateTime()
    declare completionTime: DateTime | null

    @column({
        prepare: (v) => v ? JSON.stringify(v) : JSON.stringify({}),
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare metadata: any

    @column({
        serializeAs: 'statusHistory',
        prepare: (v) => v ? JSON.stringify(v) : JSON.stringify([]),
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare statusHistory: Array<{ status: string; timestamp: string; note?: string }>

    @column({
        prepare: (v) => v ? JSON.stringify(v) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare client: any

    @column()
    declare originalId: string | null

    @column()
    declare isPendingChange: boolean

    @column()
    declare isDeleteRequired: boolean

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => Stop, { foreignKey: 'originalId' })
    declare original: BelongsTo<typeof Stop>

    @belongsTo(() => Order, { foreignKey: 'orderId' })
    declare order: BelongsTo<typeof Order>

    @belongsTo(() => Address)
    declare address: BelongsTo<typeof Address>

    @hasMany(() => Action)
    declare actions: HasMany<typeof Action>
}
