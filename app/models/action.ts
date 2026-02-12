import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import TransitItem from '#models/transit_item'
import ActionProof from '#models/action_proof'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class Action extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(action: Action) {
        action.id = generateId('act')
    }

    @column()
    declare orderId: string

    /**
     * ID du Stop où cette action se déroule
     */
    @column()
    declare stopId: string

    /**
     * Lien vers l'item en transit (TransitItem)
     */
    @column()
    declare transitItemId: string | null

    /**
     * Type d'action : Collecte (+), Livraison (-), ou Service (.)
     */
    @column()
    declare type: 'PICKUP' | 'DELIVERY' | 'SERVICE'

    /**
     * Quantité concernée par cette action spécifique
     */
    @column()
    declare quantity: number

    @column()
    declare status: 'PENDING' | 'ARRIVED' | 'COMPLETED' | 'FROZEN' | 'FAILED' | 'CANCELLED'

    /**
     * Temps de service estimé au stop pour cette action (secondes)
     */
    @column()
    declare serviceTime: number

    @column({
        prepare: (v) => v ? JSON.stringify(v) : JSON.stringify({}),
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare confirmationRules: any

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

    @belongsTo(() => Action, { foreignKey: 'originalId' })
    declare original: BelongsTo<typeof Action>

    @belongsTo(() => Order, { foreignKey: 'orderId' })
    declare order: BelongsTo<typeof Order>

    @belongsTo(() => TransitItem, { foreignKey: 'transitItemId' })
    declare transitItem: BelongsTo<typeof TransitItem>

    @hasMany(() => ActionProof)
    declare proofs: HasMany<typeof ActionProof>
}
