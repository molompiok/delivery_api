import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, belongsTo, column } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class NotificationLog extends BaseModel {
  public static table = 'notification_logs'

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(model: NotificationLog) {
    if (!model.id) {
      model.id = generateId('ntf')
    }
  }

  @column()
  declare userId: string

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @column()
  declare channel: 'PUSH' | 'SMS'

  @column()
  declare type: string

  @column()
  declare title: string

  @column()
  declare body: string

  @column()
  declare orderId: string | null

  @column()
  declare status: 'SENT' | 'FAILED' | 'SKIPPED'

  @column()
  declare provider: string | null

  @column()
  declare providerMessageId: string | null

  @column()
  declare errorCode: string | null

  @column()
  declare errorMessage: string | null

  @column()
  declare tokenSnapshot: string | null

  @column({
    prepare: (value: Record<string, any> | null) => (value ? JSON.stringify(value) : JSON.stringify({})),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare data: Record<string, any>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
