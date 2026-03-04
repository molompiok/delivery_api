import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Company from '#models/company'
import SubscriptionPlan from '#models/subscription_plan'
import CompanySubscriptionOverride from '#models/company_subscription_override'

export default class CompanySubscriptionHistory extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @column()
  declare companyId: string

  @column()
  declare activityType: string

  @column()
  declare baseAmount: number

  @column()
  declare commandeCommissionPercent: number

  @column()
  declare ticketFeePercent: number

  @column()
  declare taxPercent: number

  @column()
  declare currency: string

  @column()
  declare planId: string | null

  @column()
  declare overrideId: string | null

  @column.dateTime()
  declare effectiveFrom: DateTime

  @column.dateTime()
  declare effectiveUntil: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Company)
  declare company: BelongsTo<typeof Company>

  @belongsTo(() => SubscriptionPlan, { foreignKey: 'planId' })
  declare plan: BelongsTo<typeof SubscriptionPlan>

  @belongsTo(() => CompanySubscriptionOverride, { foreignKey: 'overrideId' })
  declare override: BelongsTo<typeof CompanySubscriptionOverride>
}