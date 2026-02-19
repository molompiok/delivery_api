import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import vine from '@vinejs/vine'
import SalaryPayment from '#models/salary_payment'
import CompanyDriverSetting from '#models/company_driver_setting'
import User from '#models/user'
import walletBridge from '#services/wallet_bridge_service'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * SalaryPaymentService
 *
 * Gestion des salaires des drivers ETP (employés d'une company).
 * Cycle : DRAFT → APPROVED → PAID
 * - Validation vine dans le service
 * - trx optionnel (effectiveTrx pattern)
 * - Vérification user pour les droits company
 */

// ── Vine Schemas ──

const createSalarySchema = vine.object({
    companyDriverSettingId: vine.string(),
    periodStart: vine.string(),  // ISO date string, converti en DateTime dans le service
    periodEnd: vine.string(),
    baseSalary: vine.number().min(0),
    bonuses: vine.number().min(0).optional(),
    deductions: vine.number().min(0).optional(),
})

const adjustSchema = vine.object({
    type: vine.enum(['bonus', 'deduction']),
    amount: vine.number().min(0),
    reason: vine.string().trim().maxLength(500).optional(),
})

class SalaryPaymentService {

    // ── List / Find ──

    async listForCompany(user: User, status?: string, trx?: TransactionClientContract): Promise<SalaryPayment[]> {
        const companyId = user.currentCompanyManaged || user.companyId
        if (!companyId) throw new Error('Company access required')

        const query = SalaryPayment.query({ client: trx })
            .where('company_id', companyId)
            .orderBy('period_start', 'desc')

        if (status) {
            query.where('status', status)
        }

        return query.limit(50).exec()
    }

    async findById(id: string, user: User, trx?: TransactionClientContract): Promise<SalaryPayment> {
        const salary = await SalaryPayment.query({ client: trx }).where('id', id).firstOrFail()

        const companyId = user.currentCompanyManaged || user.companyId
        if (salary.companyId !== companyId) {
            throw new Error('Not authorized to access this salary')
        }

        return salary
    }

    // ── Create ──

    async create(user: User, data: any, trx?: TransactionClientContract): Promise<SalaryPayment> {
        const validated = await vine.validate({ schema: createSalarySchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            const companyId = user.currentCompanyManaged || user.companyId
            if (!companyId) throw new Error('Company access required')

            const cds = await CompanyDriverSetting.query({ client: effectiveTrx })
                .where('id', validated.companyDriverSettingId)
                .firstOrFail()

            // Vérifier que le CDS appartient à la company de l'user
            if (cds.companyId !== companyId) {
                throw new Error('Not authorized to create salary for this driver')
            }

            const periodStart = DateTime.fromISO(validated.periodStart)
            const periodEnd = DateTime.fromISO(validated.periodEnd)

            if (!periodStart.isValid || !periodEnd.isValid) {
                throw new Error('Invalid period dates')
            }

            const totalAmount = validated.baseSalary + (validated.bonuses || 0) - (validated.deductions || 0)

            const salary = await SalaryPayment.create({
                companyDriverSettingId: cds.id,
                companyId: cds.companyId,
                driverId: cds.driverId,
                periodStart,
                periodEnd,
                baseSalary: validated.baseSalary,
                bonuses: validated.bonuses || 0,
                deductions: validated.deductions || 0,
                totalAmount: Math.max(0, totalAmount),
                status: 'DRAFT',
            }, { client: effectiveTrx })

            if (!trx) await effectiveTrx.commit()

            logger.info({
                salaryId: salary.id,
                driverId: cds.driverId,
                totalAmount: salary.totalAmount,
            }, '[Salary] Period created')

            return salary
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    // ── Adjust (bonus/deduction) ──

    async adjust(id: string, user: User, data: any, trx?: TransactionClientContract): Promise<SalaryPayment> {
        const validated = await vine.validate({ schema: adjustSchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            const salary = await SalaryPayment.query({ client: effectiveTrx })
                .where('id', id)
                .forUpdate()
                .firstOrFail()

            const companyId = user.currentCompanyManaged || user.companyId
            if (salary.companyId !== companyId) {
                throw new Error('Not authorized to adjust this salary')
            }

            if (salary.status !== 'DRAFT') {
                throw new Error('Cannot modify a salary that is not in DRAFT status')
            }

            if (validated.type === 'bonus') {
                salary.bonuses += validated.amount
            } else {
                salary.deductions += validated.amount
            }

            salary.totalAmount = Math.max(0, salary.baseSalary + salary.bonuses - salary.deductions)
            await salary.useTransaction(effectiveTrx).save()

            if (!trx) await effectiveTrx.commit()

            logger.debug({
                salaryId: id,
                type: validated.type,
                amount: validated.amount,
                newTotal: salary.totalAmount,
            }, `[Salary] ${validated.type} added`)

            return salary
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    // ── Approve ──

    async approve(id: string, user: User, trx?: TransactionClientContract): Promise<SalaryPayment> {
        const effectiveTrx = trx || await db.transaction()

        try {
            const salary = await SalaryPayment.query({ client: effectiveTrx })
                .where('id', id)
                .forUpdate()
                .firstOrFail()

            const companyId = user.currentCompanyManaged || user.companyId
            if (salary.companyId !== companyId) {
                throw new Error('Not authorized to approve this salary')
            }

            if (salary.status !== 'DRAFT') {
                throw new Error('Salary must be in DRAFT status to approve')
            }

            salary.status = 'APPROVED'
            await salary.useTransaction(effectiveTrx).save()

            if (!trx) await effectiveTrx.commit()

            logger.info({ salaryId: id, totalAmount: salary.totalAmount }, '[Salary] Approved')
            return salary
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    // ── Pay ──

    async pay(id: string, user: User, trx?: TransactionClientContract): Promise<SalaryPayment> {
        const effectiveTrx = trx || await db.transaction()

        try {
            const salary = await SalaryPayment.query({ client: effectiveTrx })
                .where('id', id)
                .forUpdate()
                .firstOrFail()

            const companyId = user.currentCompanyManaged || user.companyId
            if (salary.companyId !== companyId) {
                throw new Error('Not authorized to pay this salary')
            }

            if (salary.status !== 'APPROVED') {
                throw new Error('Salary must be APPROVED before payment')
            }

            const cds = await CompanyDriverSetting.findOrFail(salary.companyDriverSettingId, { client: effectiveTrx })
            if (!cds.walletId) {
                throw new Error('Driver company wallet not configured')
            }

            const Company = (await import('#models/company')).default
            const company = await Company.findOrFail(salary.companyId, { client: effectiveTrx })
            if (!company.walletId) {
                throw new Error('Company wallet not configured')
            }

            try {
                const result = await walletBridge.createInternalTransfer({
                    payer_wallet_id: company.walletId,
                    amount: salary.totalAmount,
                    description: `Salaire ${salary.periodStart.toFormat('yyyy-MM-dd')} - ${salary.periodEnd.toFormat('yyyy-MM-dd')}`,
                    external_reference: `salary_${salary.id}`,
                    splits: [{
                        wallet_id: cds.walletId,
                        amount: salary.totalAmount,
                        category: 'SALARY',
                        label: `Salaire période ${salary.periodStart.toFormat('dd/MM')} - ${salary.periodEnd.toFormat('dd/MM')}`,
                    }],
                })

                salary.internalPaymentIntentId = result.internal_payment_intent_id
                salary.status = 'PAID'
                salary.paidAt = DateTime.now()
                await salary.useTransaction(effectiveTrx).save()

                if (!trx) await effectiveTrx.commit()

                logger.info({
                    salaryId: id,
                    intentId: result.internal_payment_intent_id,
                    amount: salary.totalAmount,
                }, '[Salary] Paid')
            } catch (error) {
                salary.status = 'FAILED'
                await salary.useTransaction(effectiveTrx).save()
                if (!trx) await effectiveTrx.commit()
                logger.error({ salaryId: id, error }, '[Salary] Payment failed')
                throw error
            }

            return salary
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    // ── Batch pay ──

    async batchPay(user: User, ids?: string[]): Promise<{ paid: number; failed: number }> {
        const companyId = user.currentCompanyManaged || user.companyId
        if (!companyId) throw new Error('Company access required')

        let query = SalaryPayment.query()
            .where('company_id', companyId)
            .where('status', 'APPROVED')

        if (ids && ids.length > 0) {
            query = query.whereIn('id', ids)
        }

        const approved = await query.exec()

        let paid = 0
        let failed = 0

        for (const salary of approved) {
            try {
                await this.pay(salary.id, user)
                paid++
            } catch (error) {
                logger.error({ salaryId: salary.id, error }, '[Salary] Batch pay failed')
                failed++
            }
        }

        logger.info({ companyId, paid, failed }, '[Salary] Batch payment completed')
        return { paid, failed }
    }

    // ── Helpers (utilisables par d'autres services) ──

    async getForDriver(driverId: string, limit = 20, trx?: TransactionClientContract): Promise<SalaryPayment[]> {
        return SalaryPayment.query({ client: trx })
            .where('driver_id', driverId)
            .orderBy('period_start', 'desc')
            .limit(limit)
            .exec()
    }
}

export default new SalaryPaymentService()
