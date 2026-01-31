import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import User from '#models/user'
import Task from '#models/task'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { hasMany } from '@adonisjs/lucid/orm'

export default class Mission extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(mission: Mission) {
        mission.id = generateId('msn')
    }

    @column()
    declare orderId: string

    @column()
    declare driverId: string | null

    @column()
    declare status: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'

    @column.dateTime()
    declare startAt: DateTime | null

    @column.dateTime()
    declare completedAt: DateTime | null

    @column({
        prepare: (v) => v ? JSON.stringify(v) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare optimizedData: any

    @column()
    declare estimatedDuration: number | null

    @column()
    declare estimatedDistance: number | null

    @column({
        prepare: (v) => v ? JSON.stringify(v) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare routeGeometry: any

    @belongsTo(() => Order)
    declare order: BelongsTo<typeof Order>

    @belongsTo(() => User, { foreignKey: 'driverId' })
    declare driver: BelongsTo<typeof User>

    @hasMany(() => Task)
    declare tasks: HasMany<typeof Task>

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
