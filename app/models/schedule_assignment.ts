import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Schedule from '#models/schedule'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class ScheduleAssignment extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @beforeCreate()
  static async setDefaults(assignment: ScheduleAssignment) {
    if (!assignment.assignedAt) {
      assignment.assignedAt = DateTime.now()
    }
  }

  @column()
  declare scheduleId: string

  @column()
  declare userId: string

  @column()
  declare assignedBy: string | null

  @column.dateTime()
  declare assignedAt: DateTime

  @belongsTo(() => Schedule, { foreignKey: 'scheduleId' })
  declare schedule: BelongsTo<typeof Schedule>

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'assignedBy' })
  declare assignedByUser: BelongsTo<typeof User>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}