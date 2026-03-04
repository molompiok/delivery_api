import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import type { OrderTemplate } from '#constants/order_templates'

export default class SubscriptionPlan extends BaseModel {
  public static table = 'subscription_plans'

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(plan: SubscriptionPlan) {
    plan.id = generateId('sbp')
  }

  @column()
  declare activityType: OrderTemplate

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
  declare isActive: boolean

  @column()
  declare allowNewCompanies: boolean

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
