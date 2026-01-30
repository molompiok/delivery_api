import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class SecurityLog extends BaseModel {
    @column({ isPrimary: true })
    declare id: number

    @column()
    declare type: string

    @column()
    declare severity: string

    @column()
    declare source: string

    @column()
    declare ipAddress: string

    @column()
    declare userId: string | null

    @column({
        prepare: (value: any) => JSON.stringify(value),
        consume: (value: string) => (typeof value === 'string' ? JSON.parse(value) : value),
    })
    declare metaData: any

    @column()
    declare details: string | null

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime
}
