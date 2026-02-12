import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class DriverLocationHistory extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: string

  @column()
  declare lat: number

  @column()
  declare lng: number

  @column()
  declare heading: number | null

  @column.dateTime()
  declare timestamp: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}