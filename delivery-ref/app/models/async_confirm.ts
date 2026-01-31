import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export enum AsyncConfirmType {
    OTP = 'OTP',
    EMAIL = 'EMAIL',
    ACTION = 'ACTION',
    ACCOUNT_SETUP = 'ACCOUNT_SETUP',
    PASSWORD_RESET = 'PASSWORD_RESET',
    PHONE_OTP = 'PHONE_OTP' // New type for SMS OTP
}

export default class AsyncConfirm extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(confirm: AsyncConfirm) {
        confirm.id = generateId('asnc')
    }

    @column()
    declare userId: string | null

    @column()
    declare tokenHash: string

    @column()
    declare type: AsyncConfirmType

    @column.dateTime()
    declare expiresAt: DateTime

    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : JSON.stringify({}),
    })
    declare payload: any

    @belongsTo(() => User)
    declare user: BelongsTo<typeof User>

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @column.dateTime()
    declare usedAt: DateTime | null
}
