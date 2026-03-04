import { DateTime } from 'luxon'
import vine from '@vinejs/vine'
import db from '@adonisjs/lucid/services/db'
import Company from '#models/company'
import User from '#models/user'
import SubscriptionPlan from '#models/subscription_plan'
import CompanySubscriptionOverride from '#models/company_subscription_override'
import SubscriptionInvoice from '#models/subscription_invoice'
import CompanySubscriptionHistory from '#models/company_subscription_history'
import { generateId } from '#utils/id_generator'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type Order from '#models/order'

type KnownActivityType = 'COMMANDE' | 'VOYAGE' | 'MISSION'

export interface ResolvedSubscriptionRates {
  activityType: KnownActivityType
  baseAmount: number
  commandeCommissionPercent: number
  ticketFeePercent: number
  taxPercent: number
  currency: string
  source: {
    planId: string | null
    overrideId: string | null
  }
}

const KNOWN_ACTIVITY_TYPES: KnownActivityType[] = ['COMMANDE', 'VOYAGE', 'MISSION']
const DEFAULT_PLAN_VALUES: Record<
  KnownActivityType,
  { baseAmount: number; commandeCommissionPercent: number; ticketFeePercent: number; taxPercent: number }
> = {
  COMMANDE: { baseAmount: 0, commandeCommissionPercent: 1, ticketFeePercent: 0, taxPercent: 0 },
  VOYAGE: { baseAmount: 100000, commandeCommissionPercent: 0, ticketFeePercent: 0, taxPercent: 0 },
  MISSION: { baseAmount: 100000, commandeCommissionPercent: 0, ticketFeePercent: 0, taxPercent: 0 },
}

const upsertPlanSchema = vine.object({
  activityType: vine.string().trim(),
  baseAmount: vine.number().min(0),
  commandeCommissionPercent: vine.number().min(0).max(100),
  ticketFeePercent: vine.number().min(0).max(100),
  taxPercent: vine.number().min(0).max(100).optional(),
  currency: vine.string().trim().minLength(3).maxLength(8).optional(),
  allowNewCompanies: vine.boolean().optional(),
  isActive: vine.boolean().optional(),
  metadata: vine.any().optional(),
})

const upsertOverrideSchema = vine.object({
  baseAmount: vine.number().min(0).nullable().optional(),
  commandeCommissionPercent: vine.number().min(0).max(100).nullable().optional(),
  ticketFeePercent: vine.number().min(0).max(100).nullable().optional(),
  taxPercent: vine.number().min(0).max(100).nullable().optional(),
  currency: vine.string().trim().minLength(3).maxLength(8).nullable().optional(),
  isActive: vine.boolean().optional(),
  metadata: vine.any().optional(),
})

const generateInvoicesSchema = vine.object({
  month: vine.string().trim().regex(/^\d{4}-\d{2}$/).optional(),
})

const markInvoicePaidSchema = vine.object({
  paymentReference: vine.string().trim().maxLength(255).optional(),
  metadata: vine.any().optional(),
})

class SubscriptionService {
  private normalizeActivityType(value: string | null | undefined): KnownActivityType {
    const normalized = String(value || '').trim().toUpperCase()
    if (!KNOWN_ACTIVITY_TYPES.includes(normalized as KnownActivityType)) {
      throw new Error(
        `E_INVALID_ACTIVITY_TYPE: "${value}" is not supported. Allowed values: ${KNOWN_ACTIVITY_TYPES.join(', ')}`
      )
    }
    return normalized as KnownActivityType
  }

  private assertAdmin(user: User) {
    if (!user.isAdmin) {
      throw new Error('Admin access required')
    }
  }

  private toNumber(value: unknown, fallback = 0): number {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }

  private resolveMonthPeriod(month?: string): {
    monthKey: string
    periodStart: DateTime
    periodEndExclusive: DateTime
    periodEndDate: DateTime
  } {
    let periodStart = DateTime.utc().startOf('month').minus({ months: 1 })
    if (month) {
      const parsed = DateTime.fromFormat(month, 'yyyy-LL', { zone: 'utc' }).startOf('month')
      if (!parsed.isValid) {
        throw new Error(`Invalid month format "${month}". Expected YYYY-MM`)
      }
      periodStart = parsed
    }

    const periodEndExclusive = periodStart.plus({ months: 1 })
    const periodEndDate = periodEndExclusive.minus({ days: 1 })
    return {
      monthKey: periodStart.toFormat('yyyy-LL'),
      periodStart,
      periodEndExclusive,
      periodEndDate,
    }
  }

  /**
   * Records the current effective rates for a company into history.
   * Closes the previous record if it exists and is different.
   */
  async recordSubscriptionHistory(
    companyId: string,
    trx?: TransactionClientContract
  ): Promise<CompanySubscriptionHistory> {
    const effectiveTrx = trx || (await db.transaction())
    try {
      const rates = await this.resolveEffectiveRates(companyId, effectiveTrx)
      const now = DateTime.utc()

      const currentActive = await CompanySubscriptionHistory.query({ client: effectiveTrx })
        .where('company_id', companyId)
        .whereNull('effective_until')
        .first()

      if (
        currentActive &&
        currentActive.baseAmount === rates.baseAmount &&
        currentActive.commandeCommissionPercent === rates.commandeCommissionPercent &&
        currentActive.ticketFeePercent === rates.ticketFeePercent &&
        currentActive.taxPercent === rates.taxPercent &&
        currentActive.currency === rates.currency &&
        currentActive.activityType === rates.activityType &&
        currentActive.planId === rates.source.planId &&
        currentActive.overrideId === rates.source.overrideId
      ) {
        if (!trx) await effectiveTrx.commit()
        return currentActive
      }

      if (currentActive) {
        currentActive.effectiveUntil = now
        await currentActive.useTransaction(effectiveTrx).save()
      }

      const next = await CompanySubscriptionHistory.create(
        {
          id: generateId('subh'),
          companyId,
          activityType: rates.activityType,
          baseAmount: rates.baseAmount,
          commandeCommissionPercent: rates.commandeCommissionPercent,
          ticketFeePercent: rates.ticketFeePercent,
          taxPercent: rates.taxPercent,
          currency: rates.currency,
          planId: rates.source.planId,
          overrideId: rates.source.overrideId,
          effectiveFrom: currentActive ? now : now.startOf('month'), // If first time, assume start of month
          effectiveUntil: null,
        },
        { client: effectiveTrx }
      )

      if (!trx) await effectiveTrx.commit()
      return next
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }

  async assertCompanyCanConsume(
    companyId: string,
    trx?: TransactionClientContract,
    options: { graceDays?: number; context?: string } = {}
  ): Promise<void> {
    const graceDaysRaw = Number(options.graceDays ?? 7)
    const graceDays = Number.isFinite(graceDaysRaw) ? Math.max(0, Math.floor(graceDaysRaw)) : 7
    const cutoff = DateTime.utc().minus({ days: graceDays }).toSQL({ includeOffset: false })!

    const blockingInvoice = await SubscriptionInvoice.query({ client: trx })
      .where('company_id', companyId)
      .where((q) => {
        q.where((issuedQ) => {
          issuedQ.where('status', 'ISSUED').whereNotNull('due_at').where('due_at', '<=', cutoff)
        }).orWhere((overdueQ) => {
          overdueQ.where('status', 'OVERDUE').whereNotNull('due_at').where('due_at', '<=', cutoff)
        })
      })
      .orderBy('due_at', 'asc')
      .first()

    if (!blockingInvoice) return

    const dueAt = blockingInvoice.dueAt ? blockingInvoice.dueAt.toISO() : null
    const context = options.context || 'order_operation'
    throw new Error(
      `E_SUBSCRIPTION_BLOCKED: company ${companyId} has unpaid subscription invoice ${blockingInvoice.id} (status=${blockingInvoice.status}, due_at=${dueAt}) beyond grace period (${graceDays} day(s)). Blocked context=${context}.`
    )
  }

  async ensurePlanExistsForActivityType(
    activityType: string,
    trx?: TransactionClientContract
  ): Promise<SubscriptionPlan> {
    const normalized = this.normalizeActivityType(activityType)
    let plan = await SubscriptionPlan.query({ client: trx })
      .where('activity_type', normalized)
      .where('is_active', true)
      .first()

    if (!plan) {
      const defaults = DEFAULT_PLAN_VALUES[normalized]
      plan = await SubscriptionPlan.updateOrCreate(
        { activityType: normalized },
        {
          activityType: normalized,
          baseAmount: defaults.baseAmount,
          commandeCommissionPercent: defaults.commandeCommissionPercent,
          ticketFeePercent: defaults.ticketFeePercent,
          taxPercent: defaults.taxPercent,
          currency: 'XOF',
          isActive: true,
          allowNewCompanies: true,
          metadata: { autoProvisioned: true, reason: 'missing_plan' },
        },
        { client: trx }
      )
    }
    return plan
  }

  async ensurePlanCanBeAssignedToCompany(
    activityType: string,
    trx?: TransactionClientContract
  ): Promise<SubscriptionPlan> {
    const plan = await this.ensurePlanExistsForActivityType(activityType, trx)
    if (!plan.allowNewCompanies) {
      throw new Error(
        `E_SUBSCRIPTION_ACTIVITY_CLOSED: activityType=${this.normalizeActivityType(
          activityType
        )} is closed for new company assignment.`
      )
    }
    return plan
  }

  async listPlans(trx?: TransactionClientContract): Promise<SubscriptionPlan[]> {
    return SubscriptionPlan.query({ client: trx }).orderBy('activity_type', 'asc')
  }

  async upsertPlan(
    admin: User,
    data: any,
    trx?: TransactionClientContract
  ): Promise<SubscriptionPlan> {
    this.assertAdmin(admin)
    const validated = await vine.validate({ schema: upsertPlanSchema, data })
    if (validated.isActive === false) {
      throw new Error('E_SUBSCRIPTION_REVOKE_FORBIDDEN: subscription plans cannot be deactivated')
    }
    const effectiveTrx = trx || (await db.transaction())

    try {
      const activityType = this.normalizeActivityType(validated.activityType)
      const plan = await SubscriptionPlan.updateOrCreate(
        { activityType },
        {
          activityType,
          baseAmount: Math.round(validated.baseAmount),
          commandeCommissionPercent: validated.commandeCommissionPercent,
          ticketFeePercent: validated.ticketFeePercent,
          taxPercent: validated.taxPercent ?? 0,
          currency: String(validated.currency || 'XOF').toUpperCase(),
          isActive: true,
          allowNewCompanies: validated.allowNewCompanies ?? true,
          metadata: {
            ...(validated.metadata || {}),
            updatedBy: admin.id,
            updatedAt: DateTime.utc().toISO(),
          },
        },
        { client: effectiveTrx }
      )

      if (!trx) await effectiveTrx.commit()
      return plan
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }

  async listCompanyOverrides(
    admin: User,
    companyId?: string,
    trx?: TransactionClientContract
  ): Promise<CompanySubscriptionOverride[]> {
    this.assertAdmin(admin)
    const query = CompanySubscriptionOverride.query({ client: trx }).preload('company')
    if (companyId) query.where('company_id', companyId)
    return query.orderBy('created_at', 'desc')
  }

  async upsertCompanyOverride(
    admin: User,
    companyId: string,
    data: any,
    trx?: TransactionClientContract
  ): Promise<CompanySubscriptionOverride> {
    this.assertAdmin(admin)
    const validated = await vine.validate({ schema: upsertOverrideSchema, data })
    if (validated.isActive === false) {
      throw new Error('E_SUBSCRIPTION_REVOKE_FORBIDDEN: company overrides cannot be deactivated')
    }
    const effectiveTrx = trx || (await db.transaction())

    try {
      await Company.findOrFail(companyId, { client: effectiveTrx })
      const updatePayload: Record<string, any> = {
        companyId,
        isActive: true,
        metadata: {
          ...(validated.metadata || {}),
          updatedBy: admin.id,
          updatedAt: DateTime.utc().toISO(),
        },
      }
      if (Object.prototype.hasOwnProperty.call(validated, 'baseAmount')) {
        updatePayload.baseAmount =
          validated.baseAmount === null || validated.baseAmount === undefined
            ? validated.baseAmount
            : Math.round(validated.baseAmount)
      }
      if (Object.prototype.hasOwnProperty.call(validated, 'commandeCommissionPercent')) {
        updatePayload.commandeCommissionPercent = validated.commandeCommissionPercent
      }
      if (Object.prototype.hasOwnProperty.call(validated, 'ticketFeePercent')) {
        updatePayload.ticketFeePercent = validated.ticketFeePercent
      }
      if (Object.prototype.hasOwnProperty.call(validated, 'taxPercent')) {
        updatePayload.taxPercent = validated.taxPercent
      }
      if (Object.prototype.hasOwnProperty.call(validated, 'currency')) {
        updatePayload.currency =
          validated.currency === null || validated.currency === undefined
            ? validated.currency
            : String(validated.currency).toUpperCase()
      }

      const override = await CompanySubscriptionOverride.updateOrCreate(
        { companyId },
        updatePayload,
        { client: effectiveTrx }
      )

      await this.recordSubscriptionHistory(companyId, effectiveTrx)

      if (!trx) await effectiveTrx.commit()
      return override
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }

  async changeCompanyPlan(
    admin: User,
    companyId: string,
    newActivityType: string,
    trx?: TransactionClientContract
  ): Promise<Company> {
    this.assertAdmin(admin)
    return this.internalChangeCompanyPlan(companyId, newActivityType, trx)
  }

  async changeMyCompanyPlan(
    user: User,
    newActivityType: string,
    trx?: TransactionClientContract
  ): Promise<Company> {
    const companyId = user.currentCompanyManaged || user.companyId
    if (!companyId) {
      throw new Error('E_NO_COMPANY: user has no associated company')
    }
    // Simple permission check: if they managed or belong, they can change? 
    // In a real app we might check if they are "OWNER" or "MANAGER".
    return this.internalChangeCompanyPlan(companyId, newActivityType, trx)
  }

  private async internalChangeCompanyPlan(
    companyId: string,
    newActivityType: string,
    trx?: TransactionClientContract
  ): Promise<Company> {
    const normalized = this.normalizeActivityType(newActivityType)
    const effectiveTrx = trx || (await db.transaction())

    try {
      const company = await Company.findOrFail(companyId, { client: effectiveTrx })

      if (company.activityType === (normalized as any)) {
        if (!trx) await effectiveTrx.commit()
        return company
      }

      company.activityType = normalized as any
      await company.useTransaction(effectiveTrx).save()

      // Record history immediately
      await this.recordSubscriptionHistory(companyId, effectiveTrx)

      if (!trx) await effectiveTrx.commit()
      return company
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }

  async resolveEffectiveRates(
    companyId: string,
    trx?: TransactionClientContract,
    preloadedCompany?: Company
  ): Promise<ResolvedSubscriptionRates> {
    const company = preloadedCompany || (await Company.findOrFail(companyId, { client: trx }))
    const activityType = this.normalizeActivityType(company.activityType)

    const plan = await this.ensurePlanExistsForActivityType(activityType, trx)
    const override = await CompanySubscriptionOverride.query({ client: trx })
      .where('company_id', company.id)
      .where('is_active', true)
      .first()

    return {
      activityType,
      baseAmount: override?.baseAmount ?? plan.baseAmount,
      commandeCommissionPercent:
        override?.commandeCommissionPercent ?? plan.commandeCommissionPercent,
      ticketFeePercent: override?.ticketFeePercent ?? plan.ticketFeePercent,
      taxPercent: override?.taxPercent ?? plan.taxPercent,
      currency: override?.currency || plan.currency || 'XOF',
      source: {
        planId: plan.id,
        overrideId: override?.id || null,
      },
    }
  }

  async resolveRatesForOrder(
    order: Order,
    trx?: TransactionClientContract
  ): Promise<ResolvedSubscriptionRates> {
    if (!order.companyId) {
      return {
        activityType: 'COMMANDE',
        baseAmount: 0,
        commandeCommissionPercent: 1,
        ticketFeePercent: 0,
        taxPercent: 0,
        currency: 'XOF',
        source: {
          planId: null,
          overrideId: null,
        },
      }
    }
    return this.resolveEffectiveRates(order.companyId, trx)
  }

  public async computeUsageForPeriod(
    companyId: string,
    periodStart: DateTime,
    periodEndExclusive: DateTime,
    trx?: TransactionClientContract
  ): Promise<{
    commandeUsageAmount: number
    ticketUsageAmount: number
    commandeOrderCount: number
    voyageOrderCount: number
  }> {
    const startTs = periodStart.toSQL({ includeOffset: false })!
    const endTs = periodEndExclusive.toSQL({ includeOffset: false })!

    const [commandeUsageRow, ticketUsageRow, commandeCountRow, voyageCountRow] = await Promise.all([
      (trx ? db.from('payment_intents as pi').useTransaction(trx) : db.from('payment_intents as pi'))
        .join('orders as o', 'o.id', 'pi.order_id')
        .where('o.company_id', companyId)
        .where('o.template', 'COMMANDE')
        .where('o.status', 'DELIVERED')
        .whereNotIn('pi.status', ['FAILED', 'REFUNDED'])
        .whereNotNull('o.delivered_at')
        .whereBetween('o.delivered_at', [startTs, endTs])
        .sum('pi.amount as total')
        .first(),
      (trx ? db.from('payment_intents as pi').useTransaction(trx) : db.from('payment_intents as pi'))
        .join('orders as o', 'o.id', 'pi.order_id')
        .where('o.company_id', companyId)
        .where('o.template', 'VOYAGE')
        .where('o.status', 'DELIVERED')
        .whereNotIn('pi.status', ['FAILED', 'REFUNDED'])
        .whereNotNull('pi.booking_id')
        .whereNotNull('o.delivered_at')
        .whereBetween('o.delivered_at', [startTs, endTs])
        .sum('pi.amount as total')
        .first(),
      (trx ? db.from('orders').useTransaction(trx) : db.from('orders'))
        .where('company_id', companyId)
        .where('template', 'COMMANDE')
        .where('status', 'DELIVERED')
        .whereNotNull('delivered_at')
        .whereBetween('delivered_at', [startTs, endTs])
        .countDistinct('id as total')
        .first(),
      (trx ? db.from('orders').useTransaction(trx) : db.from('orders'))
        .where('company_id', companyId)
        .where('template', 'VOYAGE')
        .where('status', 'DELIVERED')
        .whereNotNull('delivered_at')
        .whereBetween('delivered_at', [startTs, endTs])
        .countDistinct('id as total')
        .first(),
    ])

    return {
      commandeUsageAmount: this.toNumber(commandeUsageRow?.total, 0),
      ticketUsageAmount: this.toNumber(ticketUsageRow?.total, 0),
      commandeOrderCount: Math.round(this.toNumber(commandeCountRow?.total, 0)),
      voyageOrderCount: Math.round(this.toNumber(voyageCountRow?.total, 0)),
    }
  }

  /**
   * Generates or updates an invoice for a specific company and period.
   * Internal method called by batch processes.
   */
  async generateInvoiceForCompany(
    companyId: string,
    periodStart: DateTime,
    periodEndExclusive: DateTime,
    monthKey: string,
    generatedByUserId?: string | null,
    trx?: TransactionClientContract
  ): Promise<'GENERATED' | 'UPDATED' | 'SKIPPED_PAID'> {
    const effectiveTrx = trx || (await db.transaction())
    try {
      const totalDaysInMonth = Math.max(1, periodEndExclusive.diff(periodStart, 'days').days)
      const periodEndDate = periodEndExclusive.minus({ days: 1 })

      // 1. Resolve history records for the period
      let history = await CompanySubscriptionHistory.query({ client: effectiveTrx })
        .where('company_id', companyId)
        .where((q) => {
          q.whereNull('effective_until').orWhere('effective_until', '>=', periodStart.toSQL()!)
        })
        .where('effective_from', '<', periodEndExclusive.toSQL()!)
        .orderBy('effective_from', 'asc')

      // 2. If no history, record current and use it as full month
      if (history.length === 0) {
        const recorded = await this.recordSubscriptionHistory(companyId, effectiveTrx)
        history = [recorded]
      }

      let totalBaseAmount = 0
      let totalCommandeCommissionAmount = 0
      let totalTicketFeeAmount = 0
      let totalTaxAmount = 0

      const usageAgg = {
        commandeUsageAmount: 0,
        ticketUsageAmount: 0,
        commandeOrderCount: 0,
        voyageOrderCount: 0,
      }

      // 3. Process segments (Prorata)
      for (const record of history) {
        const segmentStart = DateTime.max(periodStart, record.effectiveFrom)
        const segmentEnd = record.effectiveUntil
          ? DateTime.min(periodEndExclusive, record.effectiveUntil)
          : periodEndExclusive

        const segmentDays = Math.max(0, segmentEnd.diff(segmentStart, 'days').days)
        if (segmentDays <= 0) continue

        // Base amount prorata
        totalBaseAmount += (record.baseAmount * segmentDays) / totalDaysInMonth

        // Usage per segment
        const segmentUsage = await this.computeUsageForPeriod(
          companyId,
          segmentStart,
          segmentEnd,
          effectiveTrx
        )

        const segmentCommandeComm = Math.round(
          (segmentUsage.commandeUsageAmount * record.commandeCommissionPercent) / 100
        )
        const segmentTicketFee = Math.round(
          (segmentUsage.ticketUsageAmount * record.ticketFeePercent) / 100
        )

        totalCommandeCommissionAmount += segmentCommandeComm
        totalTicketFeeAmount += segmentTicketFee

        const segmentSubtotal = (record.baseAmount * segmentDays) / totalDaysInMonth + segmentCommandeComm + segmentTicketFee
        totalTaxAmount += (segmentSubtotal * record.taxPercent) / 100

        usageAgg.commandeUsageAmount += segmentUsage.commandeUsageAmount
        usageAgg.ticketUsageAmount += segmentUsage.ticketUsageAmount
        usageAgg.commandeOrderCount += segmentUsage.commandeOrderCount
        usageAgg.voyageOrderCount += segmentUsage.voyageOrderCount
      }

      totalBaseAmount = Math.round(totalBaseAmount)
      totalTaxAmount = Math.round(totalTaxAmount)
      const totalAmount = totalBaseAmount + totalCommandeCommissionAmount + totalTicketFeeAmount
      const totalAmountWithTax = totalAmount + totalTaxAmount

      const periodStartIso = periodStart.toISODate()!
      const periodEndIso = periodEndDate.toISODate()!

      const existing = await SubscriptionInvoice.query({ client: effectiveTrx })
        .where('company_id', companyId)
        .where('period_start', periodStartIso)
        .where('period_end', periodEndIso)
        .forUpdate()
        .first()

      const metadata = {
        month: monthKey,
        usageBasis: {
          commande: 'GMV_DELIVERED_PAYMENT_INTENTS',
          ticket: 'GMV_DELIVERED_BOOKING_PAYMENT_INTENTS',
        },
        usage: usageAgg,
        historySnapshot: history.map((h) => h.toJSON()),
        generatedAt: DateTime.utc().toISO(),
      }

      if (!existing) {
        await SubscriptionInvoice.create(
          {
            companyId,
            generatedBy: generatedByUserId || null,
            activityTypeSnapshot: history[history.length - 1].activityType,
            periodStart,
            periodEnd: periodEndDate,
            baseAmount: totalBaseAmount,
            commandeCommissionPercent: history[history.length - 1].commandeCommissionPercent,
            ticketFeePercent: history[history.length - 1].ticketFeePercent,
            taxPercent: history[history.length - 1].taxPercent,
            currency: history[history.length - 1].currency,
            commandeUsageAmount: usageAgg.commandeUsageAmount,
            ticketUsageAmount: usageAgg.ticketUsageAmount,
            commandeCommissionAmount: totalCommandeCommissionAmount,
            ticketFeeAmount: totalTicketFeeAmount,
            totalAmount,
            taxAmount: totalTaxAmount,
            totalAmountWithTax,
            status: 'ISSUED',
            issuedAt: DateTime.utc(),
            dueAt: periodEndExclusive.plus({ days: 7 }),
            paidAt: null,
            metadata,
          },
          { client: effectiveTrx }
        )
        if (!trx) await effectiveTrx.commit()
        return 'GENERATED'
      }

      if (existing.status === 'PAID') {
        if (!trx) await effectiveTrx.commit()
        return 'SKIPPED_PAID'
      }

      existing.merge({
        baseAmount: totalBaseAmount,
        commandeUsageAmount: usageAgg.commandeUsageAmount,
        ticketUsageAmount: usageAgg.ticketUsageAmount,
        commandeCommissionAmount: totalCommandeCommissionAmount,
        ticketFeeAmount: totalTicketFeeAmount,
        totalAmount,
        taxAmount: totalTaxAmount,
        totalAmountWithTax,
        generatedBy: generatedByUserId || existing.generatedBy,
        status: existing.status === 'OVERDUE' ? 'OVERDUE' : 'ISSUED',
        issuedAt: existing.issuedAt || DateTime.utc(),
        dueAt: existing.dueAt || periodEndExclusive.plus({ days: 7 }),
        metadata,
      })
      await existing.useTransaction(effectiveTrx).save()

      if (!trx) await effectiveTrx.commit()
      return 'UPDATED'
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }

  /**
   * Legacy method or simple entry point for UI.
   * For scalability, use the Ace command which processes in batches.
   */
  async generateMonthlyInvoices(
    data: { month?: string } = {},
    generatedByUserId?: string | null,
    trx?: TransactionClientContract
  ): Promise<{ month: string; generated: number; updated: number; skippedPaid: number; companies: number }> {
    const validated = await vine.validate({ schema: generateInvoicesSchema, data })
    const { monthKey, periodStart, periodEndExclusive } = this.resolveMonthPeriod(validated.month)
    const effectiveTrx = trx || (await db.transaction())

    let generated = 0
    let updated = 0
    let skippedPaid = 0

    try {
      const companies = await Company.query({ client: effectiveTrx }).whereNotNull('activity_type')
      for (const company of companies) {
        const result = await this.generateInvoiceForCompany(
          company.id,
          periodStart,
          periodEndExclusive,
          monthKey,
          generatedByUserId,
          effectiveTrx
        )
        if (result === 'GENERATED') generated++
        else if (result === 'UPDATED') updated++
        else if (result === 'SKIPPED_PAID') skippedPaid++
      }

      if (!trx) await effectiveTrx.commit()
      return { month: monthKey, generated, updated, skippedPaid, companies: companies.length }
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }

  async markOverdueInvoices(trx?: TransactionClientContract): Promise<{ affected: number }> {
    const effectiveTrx = trx || (await db.transaction())
    try {
      const now = DateTime.utc().toSQL({ includeOffset: false })!
      const affected = await db
        .from('subscription_invoices')
        .useTransaction(effectiveTrx)
        .whereIn('status', ['ISSUED'])
        .whereNotNull('due_at')
        .where('due_at', '<', now)
        .update({
          status: 'OVERDUE',
          updated_at: DateTime.utc().toSQL({ includeOffset: false }),
        })

      if (!trx) await effectiveTrx.commit()
      return { affected: Number(affected || 0) }
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }

  async listInvoices(
    admin: User,
    filters: { companyId?: string; status?: string; month?: string; limit?: number } = {},
    trx?: TransactionClientContract
  ): Promise<SubscriptionInvoice[]> {
    this.assertAdmin(admin)
    const query = SubscriptionInvoice.query({ client: trx })
      .preload('company')
      .orderBy('period_start', 'desc')

    if (filters.companyId) query.where('company_id', filters.companyId)
    if (filters.status) query.where('status', String(filters.status).toUpperCase())
    if (filters.month) {
      const { periodStart, periodEndDate } = this.resolveMonthPeriod(filters.month)
      query.where('period_start', periodStart.toISODate()!)
      query.where('period_end', periodEndDate.toISODate()!)
    }
    query.limit(Math.min(Math.max(Number(filters.limit || 50), 1), 500))
    return query
  }

  async listInvoicesForCompany(
    companyId: string,
    filters: { status?: string; limit?: number } = {},
    trx?: TransactionClientContract
  ): Promise<SubscriptionInvoice[]> {
    const query = SubscriptionInvoice.query({ client: trx })
      .where('company_id', companyId)
      .orderBy('period_start', 'desc')
      .limit(Math.min(Math.max(Number(filters.limit || 50), 1), 500))

    if (filters.status) {
      query.where('status', String(filters.status).toUpperCase())
    }
    return query
  }

  async markInvoicePaid(
    admin: User,
    invoiceId: string,
    data: any = {},
    trx?: TransactionClientContract
  ): Promise<SubscriptionInvoice> {
    this.assertAdmin(admin)
    const validated = await vine.validate({ schema: markInvoicePaidSchema, data })
    const effectiveTrx = trx || (await db.transaction())

    try {
      const invoice = await SubscriptionInvoice.query({ client: effectiveTrx })
        .where('id', invoiceId)
        .forUpdate()
        .firstOrFail()

      invoice.status = 'PAID'
      invoice.paidAt = DateTime.utc()
      invoice.metadata = {
        ...(invoice.metadata || {}),
        ...(validated.metadata || {}),
        paymentReference: validated.paymentReference || null,
        paidBy: admin.id,
        paidAt: invoice.paidAt.toISO(),
      }
      await invoice.useTransaction(effectiveTrx).save()

      if (!trx) await effectiveTrx.commit()
      return invoice
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }
}

export default new SubscriptionService()
