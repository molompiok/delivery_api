import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

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

    @belongsTo(() => Order)
    declare order: BelongsTo<typeof Order>

    @belongsTo(() => User, { foreignKey: 'driverId' })
    declare driver: BelongsTo<typeof User>

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
