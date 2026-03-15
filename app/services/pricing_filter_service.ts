import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import vine from '@vinejs/vine'
import PricingFilter from '#models/pricing_filter'
import User from '#models/user'
import Stop from '#models/stop'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { OrderTemplate } from '#constants/order_templates'

/**
 * PricingFilterService
 *
 * Calcul des prix via les PricingFilter configurables en DB.
 * - Validation vine dans le service
 * - trx optionnel (effectiveTrx pattern)
 * - Vérification user pour les droits
 */

// ── Types ──

export interface StopPriceInput {
    distanceKm: number
    weightKg: number
    volumeM3?: number
    isFragile?: boolean
    isUrgent?: boolean
    isNight?: boolean
    prevStopDistanceKm?: number
    durationSeconds?: number
    overrideAmount?: number
    template?: OrderTemplate | null
    matrixBaseFee?: number
    matchedFromZoneId?: string
    matchedToZoneId?: string
    matrixPairKey?: string
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
    durationFee: number
    calculatedAmount: number
    finalAmount: number
    isPriceOverridden: boolean
    pricingMode?: 'ZONE_MATRIX' | 'KM_TIME'
    matrixBaseFee?: number
    matchedFromZoneId?: string
    matchedToZoneId?: string
    matrixPairKey?: string
}

interface PriceMatrixEntry {
    filterId: string
    filterName: string
    ownerType: 'COMPANY' | 'DRIVER' | 'DEFAULT'
    ownerId: string | null
    calculatedAmount: number
    finalAmount: number
    breakdown: PriceBreakdown
}

interface ZoneMatrixPair {
    fromZoneId: string
    toZoneId: string
    basePrice: number
    bidirectional?: boolean
}

interface ZoneMatrixConfig {
    pairs: ZoneMatrixPair[]
}

// ── Vine Schemas ──

const createFilterSchema = vine.object({
    companyId: vine.string().optional(),
    driverId: vine.string().optional(),
    name: vine.string().trim().minLength(2).maxLength(100),
    template: vine.string().trim().optional(),
    baseFee: vine.number().min(0).optional(),
    perKmRate: vine.number().min(0).optional(),
    perMinuteRate: vine.number().min(0).optional(),
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
    zoneMatrixEnabled: vine.boolean().optional(),
    zoneMatrix: vine.object({
        pairs: vine.array(vine.object({
            fromZoneId: vine.string().trim(),
            toZoneId: vine.string().trim(),
            basePrice: vine.number().min(0),
            bidirectional: vine.boolean().optional(),
        })).optional(),
    }).optional(),
    isActive: vine.boolean().optional(),
})

const updateFilterSchema = vine.object({
    name: vine.string().trim().minLength(2).maxLength(100).optional(),
    template: vine.string().trim().nullable().optional(),
    baseFee: vine.number().min(0).optional(),
    perKmRate: vine.number().min(0).optional(),
    perMinuteRate: vine.number().min(0).optional(),
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
    zoneMatrixEnabled: vine.boolean().optional(),
    zoneMatrix: vine.object({
        pairs: vine.array(vine.object({
            fromZoneId: vine.string().trim(),
            toZoneId: vine.string().trim(),
            basePrice: vine.number().min(0),
            bidirectional: vine.boolean().optional(),
        })).optional(),
    }).optional(),
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
        overrideAmount: vine.number().min(0).optional(),
    })).minLength(1),
    candidateIds: vine.array(vine.string()).optional(),
})

class PricingFilterService {

    // ── Resolve (chaîne driver → company → default) ──

    async resolve(driverId?: string | null, companyId?: string | null, template?: OrderTemplate | null, trx?: TransactionClientContract): Promise<PricingFilter | any> {
        if (driverId) {
            const driverFilter = await this.findWithTemplateFallback('driver_id', driverId, template, trx)
            if (driverFilter) return driverFilter
        }

        if (companyId) {
            const companyFilter = await this.findWithTemplateFallback('company_id', companyId, template, trx)
            if (companyFilter) return companyFilter
        }

        // Global fallback (isActive: true)
        return this.findGlobalFallback(template, trx)
    }

    private async findGlobalFallback(template?: OrderTemplate | null, trx?: TransactionClientContract): Promise<PricingFilter | any> {
        if (template) {
            const exact = await PricingFilter.query({ client: trx })
                .whereNull('company_id')
                .whereNull('driver_id')
                .where('is_active', true)
                .where('template', template)
                .first()
            if (exact) return exact
        }

        const global = await PricingFilter.query({ client: trx })
            .whereNull('company_id')
            .whereNull('driver_id')
            .where('is_active', true)
            .whereNull('template')
            .first()

        if (global) return global

        // --- HARDCODED SYSTEM FALLBACK (Legacy PricingService constants) ---
        return {
            baseFee: 500,
            perKmRate: 150,
            perMinuteRate: 0.6,
            minDistance: 1,
            maxDistance: null,
            perKgRate: 100, // Matching legacy Weight Surcharge
            freeWeightKg: 5, // 5000g threshold
            perM3Rate: 2500, // To match roughly the volume surcharge
            fragileMultiplier: 1.5,
            urgentMultiplier: 1.5,
            nightMultiplier: 1.3,
            proximityDiscountPercent: 10,
            proximityThresholdKm: 2,
            heavyLoadSurchargeThresholdKg: 50,
            heavyLoadSurchargePercent: 15,
            lightLoadDiscountThresholdKg: 1,
            lightLoadDiscountPercent: 5,
            template: null,
        }
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

    private normalizeZoneMatrix(raw: any): ZoneMatrixConfig {
        const sourcePairs = Array.isArray(raw?.pairs) ? raw.pairs : []
        const normalizedPairs: ZoneMatrixPair[] = []
        const seen = new Set<string>()

        for (const pair of sourcePairs) {
            const fromZoneId = String(pair?.fromZoneId || '').trim()
            const toZoneId = String(pair?.toZoneId || '').trim()
            const basePrice = Number(pair?.basePrice)
            const bidirectional = pair?.bidirectional === true

            if (!fromZoneId || !toZoneId || !Number.isFinite(basePrice) || basePrice < 0) {
                continue
            }

            const key = `${fromZoneId}->${toZoneId}`
            if (seen.has(key)) continue
            seen.add(key)

            normalizedPairs.push({
                fromZoneId,
                toZoneId,
                basePrice: Math.round(basePrice),
                bidirectional,
            })
        }

        return { pairs: normalizedPairs }
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

            if (validated.isActive) {
                await this.ensureExclusivity(validated.companyId, validated.driverId, validated.template, effectiveTrx)
            }

            const filter = await PricingFilter.create({
                companyId: validated.companyId || null,
                driverId: validated.driverId || null,
                name: validated.name,
                template: validated.template || null,
                zoneMatrixEnabled: validated.zoneMatrixEnabled ?? false,
                zoneMatrix: this.normalizeZoneMatrix(validated.zoneMatrix),
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

            if (validated.isActive && !filter.isActive) {
                await this.ensureExclusivity(filter.companyId, filter.driverId, validated.template || filter.template, effectiveTrx)
            }

            const payload = { ...validated } as any
            if (validated.zoneMatrix !== undefined) {
                payload.zoneMatrix = this.normalizeZoneMatrix(validated.zoneMatrix)
            }
            filter.merge(payload)
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

    calculateStopPrice(filter: PricingFilter | any, input: StopPriceInput): PriceBreakdown {
        const {
            distanceKm,
            weightKg,
            volumeM3 = 0,
            isFragile = false,
            isUrgent = false,
            isNight = false,
            prevStopDistanceKm,
            durationSeconds = 0,
            overrideAmount,
            template,
            matrixBaseFee,
            matchedFromZoneId,
            matchedToZoneId,
            matrixPairKey,
        } = input

        const normalizedTemplate = String(template || filter.template || '').toUpperCase()
        const hasMatrixBaseFee = normalizedTemplate === 'COMMANDE' && Number.isFinite(matrixBaseFee)

        const effectiveDistance = Math.max(distanceKm, filter.minDistance)
        const cappedDistance = filter.maxDistance ? Math.min(effectiveDistance, filter.maxDistance) : effectiveDistance

        const baseFee = hasMatrixBaseFee ? Math.round(matrixBaseFee as number) : filter.baseFee
        const distanceFee = hasMatrixBaseFee ? 0 : Math.round(cappedDistance * filter.perKmRate)

        // Ajout de la durée (désactivé en mode matrix)
        const durationMinutes = durationSeconds / 60
        const durationFee = hasMatrixBaseFee ? 0 : Math.round(durationMinutes * (filter.perMinuteRate || 0))

        const chargeableWeight = Math.max(0, weightKg - filter.freeWeightKg)
        const weightFee = Math.round(chargeableWeight * filter.perKgRate)
        const volumeFee = Math.round(volumeM3 * filter.perM3Rate)

        let subtotal = baseFee + distanceFee + weightFee + volumeFee + durationFee

        const fragileSurcharge = isFragile ? Math.round(subtotal * (filter.fragileMultiplier - 1)) : 0
        const urgentSurcharge = isUrgent ? Math.round(subtotal * (filter.urgentMultiplier - 1)) : 0
        const nightSurcharge = isNight ? Math.round(subtotal * (filter.nightMultiplier - 1)) : 0

        let proximityDiscount = 0
        if (!hasMatrixBaseFee && prevStopDistanceKm !== undefined && prevStopDistanceKm <= filter.proximityThresholdKm) {
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

        const rawAmount = subtotal + fragileSurcharge + urgentSurcharge + nightSurcharge - proximityDiscount + heavyLoadSurcharge - lightLoadDiscount
        const calculatedAmount = hasMatrixBaseFee
            ? Math.max(0, Math.round(rawAmount))
            : Math.max(500, Math.round(rawAmount))

        let finalAmount = calculatedAmount
        let isPriceOverridden = false

        if (overrideAmount !== undefined && overrideAmount !== null) {
            finalAmount = overrideAmount
            isPriceOverridden = true
        }

        return {
            baseFee,
            distanceFee,
            weightFee,
            volumeFee,
            fragileSurcharge,
            urgentSurcharge,
            nightSurcharge,
            proximityDiscount,
            heavyLoadSurcharge,
            lightLoadDiscount,
            durationFee,
            calculatedAmount,
            finalAmount,
            isPriceOverridden,
            pricingMode: hasMatrixBaseFee ? 'ZONE_MATRIX' : 'KM_TIME',
            matrixBaseFee: hasMatrixBaseFee ? baseFee : undefined,
            matchedFromZoneId: hasMatrixBaseFee ? matchedFromZoneId : undefined,
            matchedToZoneId: hasMatrixBaseFee ? matchedToZoneId : undefined,
            matrixPairKey: hasMatrixBaseFee ? matrixPairKey : undefined,
        }
    }

    calculateOrderPrice(filter: PricingFilter | any, stops: StopPriceInput[]): { calculatedAmount: number; finalAmount: number; stopBreakdowns: PriceBreakdown[] } {
        const stopBreakdowns: PriceBreakdown[] = []
        let calculatedAmount = 0
        let finalAmount = 0

        for (let i = 0; i < stops.length; i++) {
            const stop = { ...stops[i] }
            if (i > 0 && stop.prevStopDistanceKm === undefined) {
                stop.prevStopDistanceKm = stops[i].distanceKm
            }
            const breakdown = this.calculateStopPrice(filter, stop)
            stopBreakdowns.push(breakdown)
            calculatedAmount += breakdown.calculatedAmount
            finalAmount += breakdown.finalAmount
        }

        return { calculatedAmount, finalAmount, stopBreakdowns }
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
            const { calculatedAmount, finalAmount, stopBreakdowns } = this.calculateOrderPrice(filter, stops)

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
                durationFee: stopBreakdowns.reduce((s, b) => s + b.durationFee, 0),
                calculatedAmount,
                finalAmount,
                isPriceOverridden: stopBreakdowns.some(b => b.isPriceOverridden)
            }

            matrix.push({
                filterId: filter.id,
                filterName: filter.name,
                ownerType: filter.companyId ? 'COMPANY' : filter.driverId ? 'DRIVER' : 'DEFAULT',
                ownerId: filter.companyId || filter.driverId || null,
                calculatedAmount,
                finalAmount,
                breakdown: aggregated,
            })
        }

        matrix.sort((a, b) => a.finalAmount - b.finalAmount)
        logger.debug({ matrixSize: matrix.length }, '[PricingFilter] Price matrix built')
        return matrix
    }

    // ── Overrides ──

    async calculatePriceWithOverride(stopId: string, manualAmount: number, trx?: TransactionClientContract): Promise<void> {
        const stop = await Stop.query({ client: trx }).where('id', stopId).firstOrFail()

        const metadata = stop.metadata || {}
        metadata.price_override = {
            amount: manualAmount,
            overridden_at: DateTime.now().toISO(),
            is_active: true
        }

        stop.metadata = metadata
        await stop.useTransaction(trx as any).save()

        logger.info({ stopId, manualAmount }, '[PricingFilter] Price override applied')
    }

    async restoreOriginalPrice(stopId: string, trx?: TransactionClientContract): Promise<void> {
        const stop = await Stop.query({ client: trx }).where('id', stopId).firstOrFail()

        const metadata = stop.metadata || {}
        if (metadata.price_override) {
            metadata.price_override.is_active = false
            metadata.price_override.restored_at = DateTime.now().toISO()
        }

        stop.metadata = metadata
        await stop.useTransaction(trx as any).save()

        logger.info({ stopId }, '[PricingFilter] Original price restored')
    }

    // ── Private ──

    private async findWithTemplateFallback(ownerColumn: string, ownerId: string, template?: string | null, trx?: TransactionClientContract): Promise<PricingFilter | null> {
        if (template) {
            const exact = await PricingFilter.query({ client: trx })
                .where(ownerColumn, ownerId)
                .where('template', template)
                .where('is_active', true)
                .first()
            if (exact) return exact
        }

        return PricingFilter.query({ client: trx })
            .where(ownerColumn, ownerId)
            .whereNull('template')
            .where('is_active', true)
            .first()
    }

    private async ensureExclusivity(companyId?: string | null, driverId?: string | null, template?: string | null, trx?: TransactionClientContract) {
        const query = PricingFilter.query({ client: trx }).where('is_active', true)

        if (companyId) {
            query.where('company_id', companyId)
        } else if (driverId) {
            query.where('driver_id', driverId)
        } else {
            query.whereNull('company_id').whereNull('driver_id')
        }

        if (template) {
            query.where('template', template)
        } else {
            query.whereNull('template')
        }

        const existing = await query.exec()
        for (const f of existing) {
            f.isActive = false
            if (trx) {
                await f.useTransaction(trx).save()
            } else {
                await f.save()
            }
        }
    }
}

export default new PricingFilterService()
