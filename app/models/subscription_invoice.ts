import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Company from '#models/company'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { OrderTemplate } from '#constants/order_templates'

export type SubscriptionInvoiceStatus = 'ISSUED' | 'PAID' | 'OVERDUE'

export default class SubscriptionInvoice extends BaseModel {
  public static table = 'subscription_invoices'

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(invoice: SubscriptionInvoice) {
    invoice.id = generateId('siv')
  }

  @column()
  declare companyId: string

  @belongsTo(() => Company)
  declare company: BelongsTo<typeof Company>

  @column()
  declare generatedBy: string | null

  @belongsTo(() => User, { foreignKey: 'generatedBy' })
  declare generatedByUser: BelongsTo<typeof User>

  @column()
  declare activityTypeSnapshot: OrderTemplate

  @column.date()
  declare periodStart: DateTime

  @column.date()
  declare periodEnd: DateTime

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
  declare commandeUsageAmount: number

  @column()
  declare ticketUsageAmount: number

  @column()
  declare commandeCommissionAmount: number

  @column()
  declare ticketFeeAmount: number

  @column()
  declare totalAmount: number

  @column()
  declare taxAmount: number

  @column()
  declare totalAmountWithTax: number

  @column()
  declare status: SubscriptionInvoiceStatus

  @column.dateTime()
  declare issuedAt: DateTime | null

  @column.dateTime()
  declare dueAt: DateTime | null

  @column.dateTime()
  declare paidAt: DateTime | null

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
