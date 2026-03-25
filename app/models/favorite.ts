import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'

export type FavoriteOwnerType = 'User' | 'Company'
export type FavoriteKind = string
export type FavoriteSource = 'implicit' | 'manual' | 'import'
export type FavoriteContext = string

export default class Favorite extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(favorite: Favorite) {
    favorite.id = generateId('fav')
  }

  @column()
  declare ownerType: FavoriteOwnerType

  @column()
  declare ownerId: string

  @column()
  declare tableName: string

  @column()
  declare tableId: string

  @column()
  declare context: FavoriteContext

  @column()
  declare kind: FavoriteKind

  @column()
  declare source: FavoriteSource

  @column()
  declare isPinned: boolean

  @column()
  declare usageCount: number

  @column.dateTime()
  declare lastUsedAt: DateTime

  @column({
    prepare: (value: Record<string, any>) => JSON.stringify(value || {}),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare snapshot: Record<string, any>

  @column({
    prepare: (value: Record<string, any>) => JSON.stringify(value || {}),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare metadata: Record<string, any>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
