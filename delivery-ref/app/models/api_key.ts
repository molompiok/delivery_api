import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class ApiKey extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(apiKey: ApiKey) {
        apiKey.id = generateId('ak')
    }

    @column()
    declare userId: string

    @column()
    declare name: string

    @column({ serializeAs: null })
    declare keyHash: string

    @column()
    declare hint: string

    @column.dateTime()
    declare expiresAt: DateTime | null

    @column()
    declare isActive: boolean

    @belongsTo(() => User)
    declare user: BelongsTo<typeof User>

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
