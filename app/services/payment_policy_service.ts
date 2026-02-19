import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import vine from '@vinejs/vine'
import PaymentPolicy from '#models/payment_policy'
import User from '#models/user'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * PaymentPolicyService
 *
 * Gère les politiques de paiement : quand déclencher le paiement client,
 * comment rémunérer le driver, commissions, COD.
 *
 * - Validation vine dans le service
 * - trx optionnel (effectiveTrx pattern)
 * - Vérification user pour les droits
 */

// ── Vine Schemas ──

const createPolicySchema = vine.object({
    companyId: vine.string().optional(),
    driverId: vine.string().optional(),
    name: vine.string().trim().minLength(2).maxLength(100),
    domain: vine.string().trim().optional(),
    clientPaymentTrigger: vine.enum(['BEFORE_START', 'ON_DELIVERY', 'PROGRESSIVE', 'ON_ACCEPT']).optional(),
    driverPaymentTrigger: vine.enum(['ON_DELIVERY', 'PROGRESSIVE', 'SALARY', 'END_OF_PERIOD']).optional(),
    platformCommissionPercent: vine.number().min(0).max(100).optional(),
    platformCommissionFixed: vine.number().min(0).optional(),
    companyCommissionPercent: vine.number().min(0).max(100).optional(),
    companyCommissionFixed: vine.number().min(0).optional(),
    progressiveMinAmount: vine.number().min(0).optional(),
    allowCod: vine.boolean().optional(),
    codFeePercent: vine.number().min(0).max(100).optional(),
    isDefault: vine.boolean().optional(),
    isActive: vine.boolean().optional(),
})

const updatePolicySchema = vine.object({
    name: vine.string().trim().minLength(2).maxLength(100).optional(),
    domain: vine.string().trim().nullable().optional(),
    clientPaymentTrigger: vine.enum(['BEFORE_START', 'ON_DELIVERY', 'PROGRESSIVE', 'ON_ACCEPT']).optional(),
    driverPaymentTrigger: vine.enum(['ON_DELIVERY', 'PROGRESSIVE', 'SALARY', 'END_OF_PERIOD']).optional(),
    platformCommissionPercent: vine.number().min(0).max(100).optional(),
    platformCommissionFixed: vine.number().min(0).optional(),
    companyCommissionPercent: vine.number().min(0).max(100).optional(),
    companyCommissionFixed: vine.number().min(0).optional(),
    progressiveMinAmount: vine.number().min(0).nullable().optional(),
    allowCod: vine.boolean().optional(),
    codFeePercent: vine.number().min(0).max(100).optional(),
    isDefault: vine.boolean().optional(),
    isActive: vine.boolean().optional(),
})

class PaymentPolicyService {

    // ── Resolve (chaîne driver → company → default) ──

    async resolve(driverId?: string | null, companyId?: string | null, domain?: string | null, trx?: TransactionClientContract): Promise<PaymentPolicy | null> {
        // 1. Politique du driver IDEP
        if (driverId) {
            const driverPolicy = await this.findWithDomainFallback('driver_id', driverId, domain, trx)
            if (driverPolicy) {
                logger.debug({ driverId, policyId: driverPolicy.id, domain }, '[PaymentPolicy] Resolved driver policy')
                return driverPolicy
            }
        }

        // 2. Politique de l'entreprise
        if (companyId) {
            const companyPolicy = await this.findWithDomainFallback('company_id', companyId, domain, trx)
            if (companyPolicy) {
                logger.debug({ companyId, policyId: companyPolicy.id, domain }, '[PaymentPolicy] Resolved company policy')
                return companyPolicy
            }
        }

        // 3. Politique par défaut (pas de company ni driver)
        let defaultQuery = PaymentPolicy.query({ client: trx })
            .whereNull('company_id')
            .whereNull('driver_id')
            .where('is_default', true)
            .where('is_active', true)

        if (domain) {
            defaultQuery = defaultQuery.where('domain', domain)
        } else {
            defaultQuery = defaultQuery.whereNull('domain')
        }

        let defaultPolicy = await defaultQuery.first()

        // Fallback: default sans domain
        if (!defaultPolicy && domain) {
            defaultPolicy = await PaymentPolicy.query({ client: trx })
                .whereNull('company_id')
                .whereNull('driver_id')
                .where('is_default', true)
                .where('is_active', true)
                .whereNull('domain')
                .first()
        }

        if (defaultPolicy) {
            logger.debug({ policyId: defaultPolicy.id, domain }, '[PaymentPolicy] Resolved default policy')
        } else {
            logger.warn('[PaymentPolicy] No policy found (no default set)')
        }

        return defaultPolicy
    }

    // ── List / Find ──

    async listForCompany(user: User, trx?: TransactionClientContract): Promise<PaymentPolicy[]> {
        const companyId = user.currentCompanyManaged || user.companyId
        if (!companyId) throw new Error('Company access required')

        return PaymentPolicy.query({ client: trx })
            .where('company_id', companyId)
            .orderBy('created_at', 'desc')
    }

    async findById(id: string, user: User, trx?: TransactionClientContract): Promise<PaymentPolicy> {
        const policy = await PaymentPolicy.query({ client: trx }).where('id', id).firstOrFail()

        // Vérifier que l'user a le droit de voir cette politique
        const companyId = user.currentCompanyManaged || user.companyId
        if (policy.companyId && policy.companyId !== companyId) {
            throw new Error('Not authorized to access this policy')
        }

        return policy
    }

    // ── CRUD ──

    async create(user: User, data: any, trx?: TransactionClientContract): Promise<PaymentPolicy> {
        const validated = await vine.validate({ schema: createPolicySchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            // Vérifier exclusivité companyId / driverId
            if (validated.companyId && validated.driverId) {
                throw new Error('companyId and driverId are mutually exclusive')
            }

            // Si pas admin (pas de companyId ni driverId explicite), utiliser la company de l'user
            if (!validated.companyId && !validated.driverId) {
                const companyId = user.currentCompanyManaged || user.companyId
                if (companyId) {
                    validated.companyId = companyId
                }
            }

            // Vérifier droits company
            if (validated.companyId) {
                const companyId = user.currentCompanyManaged || user.companyId
                if (validated.companyId !== companyId) {
                    throw new Error('Not authorized to create policy for this company')
                }
            }

            // Si c'est un défaut, désactiver les autres défauts du même scope
            if (validated.isDefault) {
                await this.unsetOtherDefaults(validated.companyId, validated.driverId, effectiveTrx)
            }

            const policy = await PaymentPolicy.create({
                companyId: validated.companyId || null,
                driverId: validated.driverId || null,
                name: validated.name,
                domain: validated.domain || null,
                clientPaymentTrigger: validated.clientPaymentTrigger || 'ON_DELIVERY',
                driverPaymentTrigger: validated.driverPaymentTrigger || 'ON_DELIVERY',
                platformCommissionPercent: validated.platformCommissionPercent ?? 5,
                platformCommissionFixed: validated.platformCommissionFixed ?? 0,
                companyCommissionPercent: validated.companyCommissionPercent ?? 0,
                companyCommissionFixed: validated.companyCommissionFixed ?? 0,
                progressiveMinAmount: validated.progressiveMinAmount ?? null,
                allowCod: validated.allowCod ?? false,
                codFeePercent: validated.codFeePercent ?? 0,
                isDefault: validated.isDefault ?? false,
                isActive: validated.isActive ?? true,
            }, { client: effectiveTrx })

            if (!trx) await effectiveTrx.commit()

            logger.info({ policyId: policy.id, name: validated.name }, '[PaymentPolicy] Created')
            return policy
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async update(id: string, user: User, data: any, trx?: TransactionClientContract): Promise<PaymentPolicy> {
        const validated = await vine.validate({ schema: updatePolicySchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            const policy = await PaymentPolicy.query({ client: effectiveTrx })
                .where('id', id)
                .forUpdate()
                .firstOrFail()

            // Vérifier droits
            const companyId = user.currentCompanyManaged || user.companyId
            if (policy.companyId && policy.companyId !== companyId) {
                throw new Error('Not authorized to update this policy')
            }

            if (validated.isDefault && !policy.isDefault) {
                await this.unsetOtherDefaults(policy.companyId, policy.driverId, effectiveTrx)
            }

            policy.merge(validated as any)
            await policy.useTransaction(effectiveTrx).save()

            if (!trx) await effectiveTrx.commit()

            logger.info({ policyId: policy.id }, '[PaymentPolicy] Updated')
            return policy
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async delete(id: string, user: User, trx?: TransactionClientContract): Promise<void> {
        const effectiveTrx = trx || await db.transaction()

        try {
            const policy = await PaymentPolicy.query({ client: effectiveTrx })
                .where('id', id)
                .forUpdate()
                .firstOrFail()

            const companyId = user.currentCompanyManaged || user.companyId
            if (policy.companyId && policy.companyId !== companyId) {
                throw new Error('Not authorized to delete this policy')
            }

            await policy.useTransaction(effectiveTrx).delete()

            if (!trx) await effectiveTrx.commit()

            logger.info({ policyId: id }, '[PaymentPolicy] Deleted')
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    // ── Helpers ──

    async getForCompany(companyId: string, trx?: TransactionClientContract): Promise<PaymentPolicy | null> {
        return PaymentPolicy.query({ client: trx })
            .where('company_id', companyId)
            .where('is_active', true)
            .first()
    }

    async getForDriver(driverId: string, trx?: TransactionClientContract): Promise<PaymentPolicy | null> {
        return PaymentPolicy.query({ client: trx })
            .where('driver_id', driverId)
            .where('is_active', true)
            .first()
    }

    async getDefault(trx?: TransactionClientContract): Promise<PaymentPolicy | null> {
        return PaymentPolicy.query({ client: trx })
            .whereNull('company_id')
            .whereNull('driver_id')
            .where('is_default', true)
            .where('is_active', true)
            .first()
    }

    // ── Private ──

    private async findWithDomainFallback(ownerColumn: string, ownerId: string, domain?: string | null, trx?: TransactionClientContract): Promise<PaymentPolicy | null> {
        if (domain) {
            const exact = await PaymentPolicy.query({ client: trx })
                .where(ownerColumn, ownerId)
                .where('domain', domain)
                .where('is_active', true)
                .first()
            if (exact) return exact
        }

        return PaymentPolicy.query({ client: trx })
            .where(ownerColumn, ownerId)
            .whereNull('domain')
            .where('is_active', true)
            .first()
    }

    private async unsetOtherDefaults(companyId?: string | null, driverId?: string | null, trx?: TransactionClientContract) {
        const query = PaymentPolicy.query({ client: trx }).where('is_default', true)

        if (companyId) {
            query.where('company_id', companyId)
        } else if (driverId) {
            query.where('driver_id', driverId)
        } else {
            query.whereNull('company_id').whereNull('driver_id')
        }

        const existing = await query.exec()
        for (const p of existing) {
            p.isDefault = false
            if (trx) {
                await p.useTransaction(trx).save()
            } else {
                await p.save()
            }
        }
    }
}

export default new PaymentPolicyService()
