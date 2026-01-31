import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Action from '#models/action'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class ActionProof extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(proof: ActionProof) {
        proof.id = generateId('prf')
    }

    @column()
    declare actionId: string

    @column()
    declare type: 'OTP' | 'PHOTO' | 'SIGNATURE' | 'ID_CARD'

    @column()
    declare key: string

    @column()
    declare expectedValue: string | null

    @column()
    declare submittedValue: string | null

    @column()
    declare isVerified: boolean

    @column({
        prepare: (v) => v ? JSON.stringify(v) : JSON.stringify({}),
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare metadata: any

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => Action)
    declare action: BelongsTo<typeof Action>
}
