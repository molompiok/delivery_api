import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import Stop from '#models/stop'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export default class Step extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(step: Step) {
        step.id = generateId('stg') // 'stg' for Stage/Step
    }

    @column()
    declare orderId: string

    /**
     * Ordre d'exécution du groupe d'étapes
     */
    @column()
    declare sequence: number

    /**
     * Si true, tous les stops de ce step doivent être enchaînés par le même driver
     */
    @column()
    declare linked: boolean

    @column()
    declare status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'

    @column({
        prepare: (v) => v ? JSON.stringify(v) : JSON.stringify({}),
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare metadata: any

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

    @belongsTo(() => Step, { foreignKey: 'originalId' })
    declare original: BelongsTo<typeof Step>

    @belongsTo(() => Order, { foreignKey: 'orderId' })
    declare order: BelongsTo<typeof Order>

    @hasMany(() => Stop)
    declare stops: HasMany<typeof Stop>
}
