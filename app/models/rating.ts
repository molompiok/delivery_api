import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class Rating extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(rating: Rating) {
        rating.id = generateId('rtg')
    }

    @column()
    declare targetId: string

    @column()
    declare targetType: string

    @column()
    declare score: number

    @column()
    declare comment: string | null

    @column()
    declare authorId: string

    @belongsTo(() => User, { foreignKey: 'authorId' })
    declare author: BelongsTo<typeof User>

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
