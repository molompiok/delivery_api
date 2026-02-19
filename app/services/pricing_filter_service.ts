import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import vine from '@vinejs/vine'
import PricingFilter from '#models/pricing_filter'
import User from '#models/user'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * PricingFilterService
 *
 * Calcul des prix via les PricingFilter configurables en DB.
 * - Validation vine dans le service
 * - trx optionnel (effectiveTrx pattern)
 * - Vérification user pour les droits
 */

// ── Types ──

interface StopPriceInput {
    distanceKm: number
    weightKg: number
    volumeM3?: number
    isFragile?: boolean
    isUrgent?: boolean
    isNight?: boolean
    prevStopDistanceKm?: number
}

interface PriceBreakdown {
    baseFee: number
    distanceFee: number
    weightFee: number
    volumeFee: number
    fragileSurcharge: number
    urgentSurcharge: number
    nightSurcharge: number
    proximityDiscount: number
    heavyLoadSurcharge: number
    lightLoadDiscount: number
    total: number
}

interface PriceMatrixEntry {
    filterId: string
    filterName: string
    ownerType: 'COMPANY' | 'DRIVER' | 'DEFAULT'
    ownerId: string | null
    total: number
    breakdown: PriceBreakdown
}

// ── Vine Schemas ──

const createFilterSchema = vine.object({
    companyId: vine.string().optional(),
    driverId: vine.string().optional(),
    name: vine.string().trim().minLength(2).maxLength(100),
    domain: vine.string().trim().optional(),
    baseFee: vine.number().min(0).optional(),
    perKmRate: vine.number().min(0).optional(),
    minDistance: vine.number().min(0).optional(),
    maxDistance: vine.number().min(0).nullable().optional(),
    perKgRate: vine.number().min(0).optional(),
    freeWeightKg: vine.number().min(0).optional(),
    perM3Rate: vine.number().min(0).optional(),
    fragileMultiplier: vine.number().min(1).optional(),
    urgentMultiplier: vine.number().min(1).optional(),
    nightMultiplier: vine.number().min(1).optional(),
    proximityDiscountPercent: vine.number().min(0).max(100).optional(),
    proximityThresholdKm: vine.number().min(0).optional(),
    heavyLoadSurchargeThresholdKg: vine.number().min(0).optional(),
    heavyLoadSurchargePercent: vine.number().min(0).max(100).optional(),
    lightLoadDiscountThresholdKg: vine.number().min(0).optional(),
    lightLoadDiscountPercent: vine.number().min(0).max(100).optional(),
    isDefault: vine.boolean().optional(),
    isActive: vine.boolean().optional(),
})

const updateFilterSchema = vine.object({
    name: vine.string().trim().minLength(2).maxLength(100).optional(),
    domain: vine.string().trim().nullable().optional(),
    baseFee: vine.number().min(0).optional(),
    perKmRate: vine.number().min(0).optional(),
    minDistance: vine.number().min(0).optional(),
    maxDistance: vine.number().min(0).nullable().optional(),
    perKgRate: vine.number().min(0).optional(),
    freeWeightKg: vine.number().min(0).optional(),
    perM3Rate: vine.number().min(0).optional(),
    fragileMultiplier: vine.number().min(1).optional(),
    urgentMultiplier: vine.number().min(1).optional(),
    nightMultiplier: vine.number().min(1).optional(),
    proximityDiscountPercent: vine.number().min(0).max(100).optional(),
    proximityThresholdKm: vine.number().min(0).optional(),
    heavyLoadSurchargeThresholdKg: vine.number().min(0).optional(),
    heavyLoadSurchargePercent: vine.number().min(0).max(100).optional(),
    lightLoadDiscountThresholdKg: vine.number().min(0).optional(),
    lightLoadDiscountPercent: vine.number().min(0).max(100).optional(),
    isDefault: vine.boolean().optional(),
    isActive: vine.boolean().optional(),
})

const priceMatrixSchema = vine.object({
    stops: vine.array(vine.object({
        distanceKm: vine.number().min(0),
        weightKg: vine.number().min(0),
        volumeM3: vine.number().min(0).optional(),
        isFragile: vine.boolean().optional(),
        isUrgent: vine.boolean().optional(),
        isNight: vine.boolean().optional(),
        prevStopDistanceKm: vine.number().min(0).optional(),
    })).minLength(1),
    candidateIds: vine.array(vine.string()).optional(),
})

class PricingFilterService {

    // ── Resolve (chaîne driver → company → default) ──

    async resolve(driverId?: string | null, companyId?: string | null, domain?: string | null, trx?: TransactionClientContract): Promise<PricingFilter | null> {
        if (driverId) {
            const driverFilter = await this.findWithDomainFallback('driver_id', driverId, domain, trx)
            if (driverFilter) return driverFilter
        }

        if (companyId) {
            const companyFilter = await this.findWithDomainFallback('company_id', companyId, domain, trx)
            if (companyFilter) return companyFilter
        }

        if (domain) {
            const exact = await PricingFilter.query({ client: trx })
                .whereNull('company_id')
                .whereNull('driver_id')
                .where('is_default', true)
                .where('is_active', true)
                .where('domain', domain)
                .first()
            if (exact) return exact
        }

        return PricingFilter.query({ client: trx })
            .whereNull('company_id')
            .whereNull('driver_id')
            .where('is_default', true)
            .where('is_active', true)
            .whereNull('domain')
            .first()
    }

    // ── List / Find ──

    async listForCompany(user: User, trx?: TransactionClientContract): Promise<PricingFilter[]> {
        const companyId = user.currentCompanyManaged || user.companyId
        if (!companyId) throw new Error('Company access required')

        return PricingFilter.query({ client: trx })
            .where('company_id', companyId)
            .orderBy('created_at', 'desc')
    }

    async findById(id: string, user: User, trx?: TransactionClientContract): Promise<PricingFilter> {
        const filter = await PricingFilter.query({ client: trx }).where('id', id).firstOrFail()

        const companyId = user.currentCompanyManaged || user.companyId
        if (filter.companyId && filter.companyId !== companyId) {
            throw new Error('Not authorized to access this filter')
        }

        return filter
    }

    // ── CRUD ──

    async create(user: User, data: any, trx?: TransactionClientContract): Promise<PricingFilter> {
        const validated = await vine.validate({ schema: createFilterSchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            if (validated.companyId && validated.driverId) {
                throw new Error('companyId and driverId are mutually exclusive')
            }

            // Si pas d'owner explicite, utiliser la company de l'user
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
                    throw new Error('Not authorized to create filter for this company')
                }
            }

            if (validated.isDefault) {
                await this.unsetOtherDefaults(validated.companyId, validated.driverId, effectiveTrx)
            }

            const filter = await PricingFilter.create({
                companyId: validated.companyId || null,
                driverId: validated.driverId || null,
                name: validated.name,
                domain: validated.domain || null,
                baseFee: validated.baseFee ?? 500,
                perKmRate: validated.perKmRate ?? 100,
                minDistance: validated.minDistance ?? 1,
                maxDistance: validated.maxDistance ?? null,
                perKgRate: validated.perKgRate ?? 50,
                freeWeightKg: validated.freeWeightKg ?? 5,
                perM3Rate: validated.perM3Rate ?? 200,
                fragileMultiplier: validated.fragileMultiplier ?? 1.2,
                urgentMultiplier: validated.urgentMultiplier ?? 1.5,
                nightMultiplier: validated.nightMultiplier ?? 1.3,
                proximityDiscountPercent: validated.proximityDiscountPercent ?? 10,
                proximityThresholdKm: validated.proximityThresholdKm ?? 2,
                heavyLoadSurchargeThresholdKg: validated.heavyLoadSurchargeThresholdKg ?? 50,
                heavyLoadSurchargePercent: validated.heavyLoadSurchargePercent ?? 15,
                lightLoadDiscountThresholdKg: validated.lightLoadDiscountThresholdKg ?? 1,
                lightLoadDiscountPercent: validated.lightLoadDiscountPercent ?? 5,
                isDefault: validated.isDefault ?? false,
                isActive: validated.isActive ?? true,
            }, { client: effectiveTrx })

            if (!trx) await effectiveTrx.commit()

            logger.info({ filterId: filter.id, name: validated.name }, '[PricingFilter] Created')
            return filter
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async update(id: string, user: User, data: any, trx?: TransactionClientContract): Promise<PricingFilter> {
        const validated = await vine.validate({ schema: updateFilterSchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            const filter = await PricingFilter.query({ client: effectiveTrx })
                .where('id', id)
                .forUpdate()
                .firstOrFail()

            const companyId = user.currentCompanyManaged || user.companyId
            if (filter.companyId && filter.companyId !== companyId) {
                throw new Error('Not authorized to update this filter')
            }

            if (validated.isDefault && !filter.isDefault) {
                await this.unsetOtherDefaults(filter.companyId, filter.driverId, effectiveTrx)
            }

            filter.merge(validated as any)
            await filter.useTransaction(effectiveTrx).save()

            if (!trx) await effectiveTrx.commit()

            logger.info({ filterId: filter.id }, '[PricingFilter] Updated')
            return filter
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    async delete(id: string, user: User, trx?: TransactionClientContract): Promise<void> {
        const effectiveTrx = trx || await db.transaction()

        try {
            const filter = await PricingFilter.query({ client: effectiveTrx })
                .where('id', id)
                .forUpdate()
                .firstOrFail()

            const companyId = user.currentCompanyManaged || user.companyId
            if (filter.companyId && filter.companyId !== companyId) {
                throw new Error('Not authorized to delete this filter')
            }

            await filter.useTransaction(effectiveTrx).delete()

            if (!trx) await effectiveTrx.commit()

            logger.info({ filterId: id }, '[PricingFilter] Deleted')
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    // ── Calculs ──

    calculateStopPrice(filter: PricingFilter, input: StopPriceInput): PriceBreakdown {
        const { distanceKm, weightKg, volumeM3 = 0, isFragile = false, isUrgent = false, isNight = false, prevStopDistanceKm } = input

        const effectiveDistance = Math.max(distanceKm, filter.minDistance)
        const cappedDistance = filter.maxDistance ? Math.min(effectiveDistance, filter.maxDistance) : effectiveDistance

        const baseFee = filter.baseFee
        const distanceFee = Math.round(cappedDistance * filter.perKmRate)

        const chargeableWeight = Math.max(0, weightKg - filter.freeWeightKg)
        const weightFee = Math.round(chargeableWeight * filter.perKgRate)
        const volumeFee = Math.round(volumeM3 * filter.perM3Rate)

        let subtotal = baseFee + distanceFee + weightFee + volumeFee

        const fragileSurcharge = isFragile ? Math.round(subtotal * (filter.fragileMultiplier - 1)) : 0
        const urgentSurcharge = isUrgent ? Math.round(subtotal * (filter.urgentMultiplier - 1)) : 0
        const nightSurcharge = isNight ? Math.round(subtotal * (filter.nightMultiplier - 1)) : 0

        let proximityDiscount = 0
        if (prevStopDistanceKm !== undefined && prevStopDistanceKm <= filter.proximityThresholdKm) {
            proximityDiscount = Math.round(subtotal * filter.proximityDiscountPercent / 100)
        }

        let heavyLoadSurcharge = 0
        if (weightKg >= filter.heavyLoadSurchargeThresholdKg) {
            heavyLoadSurcharge = Math.round(subtotal * filter.heavyLoadSurchargePercent / 100)
        }

        let lightLoadDiscount = 0
        if (weightKg <= filter.lightLoadDiscountThresholdKg && weightKg > 0) {
            lightLoadDiscount = Math.round(subtotal * filter.lightLoadDiscountPercent / 100)
        }

        const total = Math.max(0, subtotal + fragileSurcharge + urgentSurcharge + nightSurcharge - proximityDiscount + heavyLoadSurcharge - lightLoadDiscount)

        return { baseFee, distanceFee, weightFee, volumeFee, fragileSurcharge, urgentSurcharge, nightSurcharge, proximityDiscount, heavyLoadSurcharge, lightLoadDiscount, total }
    }

    calculateOrderPrice(filter: PricingFilter, stops: StopPriceInput[]): { total: number; stopBreakdowns: PriceBreakdown[] } {
        const stopBreakdowns: PriceBreakdown[] = []
        let total = 0

        for (let i = 0; i < stops.length; i++) {
            const stop = { ...stops[i] }
            if (i > 0 && stop.prevStopDistanceKm === undefined) {
                stop.prevStopDistanceKm = stops[i].distanceKm
            }
            const breakdown = this.calculateStopPrice(filter, stop)
            stopBreakdowns.push(breakdown)
            total += breakdown.total
        }

        return { total, stopBreakdowns }
    }

    async buildPriceMatrix(data: any, trx?: TransactionClientContract): Promise<PriceMatrixEntry[]> {
        const validated = await vine.validate({ schema: priceMatrixSchema, data })
        const stops = validated.stops as StopPriceInput[]
        const candidateIds = validated.candidateIds

        let filters: PricingFilter[]

        if (candidateIds && candidateIds.length > 0) {
            filters = await PricingFilter.query({ client: trx })
                .whereIn('id', candidateIds)
                .where('is_active', true)
                .exec()
        } else {
            filters = await PricingFilter.query({ client: trx })
                .where('is_active', true)
                .exec()
        }

        const matrix: PriceMatrixEntry[] = []

        for (const filter of filters) {
            const { total, stopBreakdowns } = this.calculateOrderPrice(filter, stops)

            const aggregated: PriceBreakdown = {
                baseFee: stopBreakdowns.reduce((s, b) => s + b.baseFee, 0),
                distanceFee: stopBreakdowns.reduce((s, b) => s + b.distanceFee, 0),
                weightFee: stopBreakdowns.reduce((s, b) => s + b.weightFee, 0),
                volumeFee: stopBreakdowns.reduce((s, b) => s + b.volumeFee, 0),
                fragileSurcharge: stopBreakdowns.reduce((s, b) => s + b.fragileSurcharge, 0),
                urgentSurcharge: stopBreakdowns.reduce((s, b) => s + b.urgentSurcharge, 0),
                nightSurcharge: stopBreakdowns.reduce((s, b) => s + b.nightSurcharge, 0),
                proximityDiscount: stopBreakdowns.reduce((s, b) => s + b.proximityDiscount, 0),
                heavyLoadSurcharge: stopBreakdowns.reduce((s, b) => s + b.heavyLoadSurcharge, 0),
                lightLoadDiscount: stopBreakdowns.reduce((s, b) => s + b.lightLoadDiscount, 0),
                total,
            }

            matrix.push({
                filterId: filter.id,
                filterName: filter.name,
                ownerType: filter.companyId ? 'COMPANY' : filter.driverId ? 'DRIVER' : 'DEFAULT',
                ownerId: filter.companyId || filter.driverId || null,
                total,
                breakdown: aggregated,
            })
        }

        matrix.sort((a, b) => a.total - b.total)
        logger.debug({ matrixSize: matrix.length }, '[PricingFilter] Price matrix built')
        return matrix
    }

    // ── Private ──

    private async findWithDomainFallback(ownerColumn: string, ownerId: string, domain?: string | null, trx?: TransactionClientContract): Promise<PricingFilter | null> {
        if (domain) {
            const exact = await PricingFilter.query({ client: trx })
                .where(ownerColumn, ownerId)
                .where('domain', domain)
                .where('is_active', true)
                .first()
            if (exact) return exact
        }

        return PricingFilter.query({ client: trx })
            .where(ownerColumn, ownerId)
            .whereNull('domain')
            .where('is_active', true)
            .first()
    }

    private async unsetOtherDefaults(companyId?: string | null, driverId?: string | null, trx?: TransactionClientContract) {
        const query = PricingFilter.query({ client: trx }).where('is_default', true)
        if (companyId) {
            query.where('company_id', companyId)
        } else if (driverId) {
            query.where('driver_id', driverId)
        } else {
            query.whereNull('company_id').whereNull('driver_id')
        }
        const existing = await query.exec()
        for (const f of existing) {
            f.isDefault = false
            if (trx) {
                await f.useTransaction(trx).save()
            } else {
                await f.save()
            }
        }
    }
}

export default new PricingFilterService()
