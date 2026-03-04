import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Company from '#models/company'

export default class CompanySubscriptionOverride extends BaseModel {
  public static table = 'company_subscription_overrides'

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(override: CompanySubscriptionOverride) {
    override.id = generateId('sbo')
  }

  @column()
  declare companyId: string

  @belongsTo(() => Company)
  declare company: BelongsTo<typeof Company>

  @column()
  declare baseAmount: number | null

  @column()
  declare commandeCommissionPercent: number | null

  @column()
  declare ticketFeePercent: number | null

  @column()
  declare taxPercent: number | null

  @column()
  declare currency: string | null

  @column()
  declare isActive: boolean

  @column({
    prepare: (value: any) => (value ? JSON.stringify(value) : JSON.stringify({})),
    consume: (value: any) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare metadata: Record<string, any>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
