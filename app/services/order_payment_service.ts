import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import vine from '@vinejs/vine'
import Order from '#models/order'
import PaymentIntent from '#models/payment_intent'
import PaymentPolicy from '#models/payment_policy'
import CodCollection from '#models/cod_collection'
import User from '#models/user'
import paymentPolicyService from '#services/payment_policy_service'
import subscriptionService from '#services/subscription_service'
import walletBridge from '#services/wallet_bridge_service'
import type { CodCollectionStatus, SettlementMode } from '#models/cod_collection'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import RedisLock from '#utils/redis_lock'
import VoyageService from '#services/voyage_service'

/**
 * OrderPaymentService
 *
 * Orchestrateur principal du cycle de vie des paiements d'une commande.
 * - Validation vine dans le service
 * - trx optionnel (effectiveTrx pattern)
 * - Vérification user pour les droits
 */

// ── Vine Schemas ──


export interface PaymentSplits {
    platformAmount: number
    companyAmount: number
    driverAmount: number
    totalNet: number
    waveFee: number
}

const authorizeSchema = vine.object({
    successUrl: vine.string().url(),
    errorUrl: vine.string().url(),
})

const codSchema = vine.object({
    expectedAmount: vine.number().min(0),
    collectedAmount: vine.number().min(0),
    changeGiven: vine.number().min(0).optional(),
    changeMethod: vine.enum(['CASH', 'WAVE']).optional(),
    clientWavePhone: vine.string().optional(),
    proofPhotoUrl: vine.string().optional(),
    notes: vine.string().optional(),
    stopId: vine.string().optional(),
})

const refundSchema = vine.object({
    reason: vine.string().trim().maxLength(500).optional(),
})

// Constantes de commission
const DEFAULT_COMMANDE_COMMISSION_PERCENT = 1
const DEFAULT_TICKET_FEE_PERCENT = 0
const DEFAULT_WAVE_PAYOUT_FEE_BPS = 100

interface WaveFeeEstimate {
    feeBps: number
    estimatedFee: number
    totalDebit: number
}

class OrderPaymentService {
    private readonly waveFeeCache = new Map<number, WaveFeeEstimate>()

    private get fallbackWaveFeeBps(): number {
        const configured = Number(process.env.WAVE_PAYOUT_FEE_BPS || DEFAULT_WAVE_PAYOUT_FEE_BPS)
        if (!Number.isFinite(configured) || configured < 0) {
            return DEFAULT_WAVE_PAYOUT_FEE_BPS
        }
        return Math.floor(configured)
    }

    private estimateWaveFeeLocally(amount: number): WaveFeeEstimate {
        const normalized = Math.max(0, Math.floor(Number(amount) || 0))
        const feeBps = this.fallbackWaveFeeBps
        const estimatedFee = Math.ceil((normalized * feeBps) / 10000)
        return {
            feeBps,
            estimatedFee,
            totalDebit: normalized + estimatedFee,
        }
    }

    public async estimateWaveFeeForAmount(amount: number): Promise<WaveFeeEstimate> {
        const normalized = Math.max(0, Math.floor(Number(amount) || 0))
        const cached = this.waveFeeCache.get(normalized)
        if (cached) return cached

        try {
            const estimate = await walletBridge.estimatePayoutFee({ amount: normalized })
            const mapped: WaveFeeEstimate = {
                feeBps: Number(estimate.fee_bps || this.fallbackWaveFeeBps),
                estimatedFee: Number(estimate.estimated_fee || 0),
                totalDebit: Number(estimate.total_debit || normalized),
            }
            this.waveFeeCache.set(normalized, mapped)
            if (this.waveFeeCache.size > 250) {
                const oldestKey = this.waveFeeCache.keys().next().value
                this.waveFeeCache.delete(oldestKey)
            }
            return mapped
        } catch (error: any) {
            logger.warn({ amount: normalized, error: error?.message }, '[PaymentIntent] Failed to fetch Wave payout fee estimate, fallback to local')
            return this.estimateWaveFeeLocally(normalized)
        }
    }

    async findById(id: string, user?: User, trx?: TransactionClientContract): Promise<PaymentIntent> {
        const query = PaymentIntent.query({ client: trx }).where('id', id)
        const intent = await query.firstOrFail()

        // Authorization check if needed
        if (user && intent.payerId !== user.id) {
            const companyId = user.currentCompanyManaged || user.companyId
            if (!companyId) throw new Error('Not authorized to view this payment intent')
        }
        return intent
    }

    async getByOrder(orderId: string, trx?: TransactionClientContract): Promise<PaymentIntent[]> {
        return PaymentIntent.query({ client: trx }).where('orderId', orderId)
    }

    async search(params: { orderId?: string, bookingId?: string, stopId?: string }, trx?: TransactionClientContract): Promise<PaymentIntent[]> {
        const query = PaymentIntent.query({ client: trx })

        if (params.orderId) {
            // General filter: could be orderId OR bookingId (common in test clients)
            query.where((q) => {
                q.where('orderId', params.orderId!)
                    .orWhere('bookingId', params.orderId!)
            })
        }

        if (params.bookingId) {
            query.where('bookingId', params.bookingId)
        }

        if (params.stopId) {
            query.where('stopId', params.stopId)
        }

        return query.orderBy('created_at', 'desc')
    }


    // ── Generate Payment Intents ──

    async generateIntentsForOrder(order: Order, trx?: TransactionClientContract): Promise<PaymentIntent[]> {
        const effectiveTrx = trx || await db.transaction()
        try {
            // Mission/Intervention flows are intentionally non-billable in this refactor.
            if (order.template === 'MISSION') {
                if (!trx) await effectiveTrx.commit()
                logger.info({ orderId: order.id, template: order.template }, '[PaymentIntent] Skipped for mission order')
                return []
            }

            await (order as any).load('stops')
            if (order.template === 'VOYAGE') {
                await (order as any).load('bookings', (bookingQuery: any) => {
                    bookingQuery.preload('transitItems')
                })
            }

            const policy = await paymentPolicyService.resolve(
                order.driverId, order.companyId, order.template, effectiveTrx
            )
            const subscriptionRates = await subscriptionService.resolveRatesForOrder(order, effectiveTrx)

            const intents: PaymentIntent[] = []

            if (order.template === 'VOYAGE') {
                // Pour VOYAGE: un intent par réservation (idempotent par booking_id)
                const bookingIds = (order.bookings || []).map((b: any) => b.id).filter(Boolean)
                const existingRows = bookingIds.length
                    ? await PaymentIntent.query({ client: effectiveTrx })
                        .where('orderId', order.id)
                        .whereIn('bookingId', bookingIds)
                        .whereNotNull('bookingId')
                        .select('bookingId')
                    : []

                const existingBookingIntentIds = new Set<string>(
                    existingRows.map((row: any) => String(row.bookingId))
                )

                for (const booking of order.bookings) {
                    if (existingBookingIntentIds.has(String(booking.id))) {
                        continue
                    }

                    const transitItems = booking.transitItems || []
                    const amount = transitItems.reduce((sum: number, item: any) => sum + (item.unitaryPrice || 0), 0)

                    const waveFeeEstimate = await this.estimateWaveFeeForAmount(amount)
                    const splits = this.calculateSplits(
                        { amount, bookingId: booking.id, calculatedAmount: amount },
                        policy,
                        order.companyId,
                        {
                            template: order.template,
                            commandeCommissionPercent: subscriptionRates.commandeCommissionPercent,
                            ticketFeePercent: subscriptionRates.ticketFeePercent,
                            waveEstimatedFee: waveFeeEstimate.estimatedFee,
                            waveFeeBps: waveFeeEstimate.feeBps,
                        }
                    )

                    const intent = await PaymentIntent.create({
                        orderId: order.id,
                        bookingId: booking.id,
                        payerId: booking.clientId,
                        amount: amount,
                        calculatedAmount: amount, // simplify for now
                        isPriceOverridden: false,
                        paymentMethod: 'WAVE', // default ?
                        status: 'PENDING',
                        platformFee: splits.platformAmount, // Using platform cut for fee
                        waveFee: splits.waveFee,
                        companyAmount: splits.companyAmount,
                        driverAmount: splits.driverAmount,
                    }, { client: effectiveTrx })
                    intents.push(intent)
                    existingBookingIntentIds.add(String(booking.id))
                }

            } else {
                // Pour COMMANDE: Payeur = Client
                const pricingData = order.pricingData as any
                const totalAmount = pricingData?.clientFee || 0
                const calculatedAmount = pricingData?.calculatedAmount || totalAmount
                const isPriceOverridden = pricingData?.isPriceOverridden || false

                if (policy?.clientPaymentTrigger === 'PROGRESSIVE') {
                    // Paiement progressif : un intent par stop (livraison)
                    const stops = order.stops.sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0))
                    // Ensure we don't divide by 0
                    if (stops.length > 0) {
                        const amountPerStop = Math.floor(totalAmount / stops.length)
                        const calculatedAmountPerStop = Math.floor(calculatedAmount / stops.length)
                        const remainder = totalAmount - (amountPerStop * stops.length)

                        for (let i = 0; i < stops.length; i++) {
                            const amnt = i === stops.length - 1 ? amountPerStop + remainder : amountPerStop
                            const calcAmnt = i === stops.length - 1 ? calculatedAmountPerStop + (calculatedAmount - (calculatedAmountPerStop * stops.length)) : calculatedAmountPerStop

                            const waveFeeEstimate = await this.estimateWaveFeeForAmount(amnt)
                            const splits = this.calculateSplits(
                                { amount: amnt, calculatedAmount: calcAmnt },
                                policy,
                                order.companyId,
                                {
                                    template: order.template,
                                    commandeCommissionPercent: subscriptionRates.commandeCommissionPercent,
                                    ticketFeePercent: subscriptionRates.ticketFeePercent,
                                    waveEstimatedFee: waveFeeEstimate.estimatedFee,
                                    waveFeeBps: waveFeeEstimate.feeBps,
                                }
                            )

                            const intent = await PaymentIntent.create({
                                orderId: order.id,
                                stopId: stops[i].id,
                                payerId: order.clientId,
                                amount: amnt,
                                calculatedAmount: calcAmnt,
                                isPriceOverridden,
                                paymentMethod: 'WAVE',
                                status: 'PENDING',
                                platformFee: splits.platformAmount,
                                waveFee: splits.waveFee,
                                companyAmount: splits.companyAmount,
                                driverAmount: splits.driverAmount,
                            }, { client: effectiveTrx })
                            intents.push(intent)
                        }
                    }
                } else {
                    // Paiement unique pour toute la commande
                    const waveFeeEstimate = await this.estimateWaveFeeForAmount(totalAmount)
                    const splits = this.calculateSplits(
                        { amount: totalAmount, calculatedAmount },
                        policy,
                        order.companyId,
                        {
                            template: order.template,
                            commandeCommissionPercent: subscriptionRates.commandeCommissionPercent,
                            ticketFeePercent: subscriptionRates.ticketFeePercent,
                            waveEstimatedFee: waveFeeEstimate.estimatedFee,
                            waveFeeBps: waveFeeEstimate.feeBps,
                        }
                    )

                    const intent = await PaymentIntent.create({
                        orderId: order.id,
                        payerId: order.clientId,
                        amount: totalAmount,
                        calculatedAmount,
                        isPriceOverridden,
                        paymentMethod: 'WAVE',
                        status: 'PENDING',
                        platformFee: splits.platformAmount,
                        waveFee: splits.waveFee,
                        companyAmount: splits.companyAmount,
                        driverAmount: splits.driverAmount,
                    }, { client: effectiveTrx })
                    intents.push(intent)
                }
            }

            if (!trx) await effectiveTrx.commit()

            logger.info({ orderId: order.id, count: intents.length }, '[PaymentIntent] Generated for order')
            return intents
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    // ── Authorize ──

    async authorize(id: string, _user: User, data: any, trx?: TransactionClientContract): Promise<{ checkoutUrl?: string }> {
        const validated = await vine.validate({ schema: authorizeSchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            const intent = await (PaymentIntent as any).query({ client: effectiveTrx })
                .where('id', id)
                .preload('booking')
                .preload('order', (q: any) => {
                    q.preload('driver')
                    q.preload('company')
                    q.preload('bookings', (bq: any) => bq.where('status', 'CONFIRMED'))
                })
                .forUpdate()
                .firstOrFail()

            // --- PRE-PAYMENT VALIDATIONS (Segment Aware & Concurrent Safe) ---
            const order = intent.order
            if (order && order.template === 'VOYAGE') {
                const voyageService = new VoyageService()

                // 1. Check Voyage Status
                if (order.status !== 'PUBLISHED') {
                    throw new Error('E_VOYAGE_NOT_AVAILABLE: Ce voyage n\'est plus disponible (déjà parti ou annulé).')
                }

                // 2. Check Seat Availability with Redis Lock
                if (intent.bookingId) {
                    await RedisLock.runWithLock(`voyage:${order.id}:seats`, async () => {
                        const currentBooking = intent.booking
                        if (!currentBooking) return

                        // Precise segment availability check
                        const availability = await voyageService.getSeats(
                            order.id,
                            currentBooking.pickupStopId || undefined,
                            currentBooking.dropoffStopId || undefined,
                            effectiveTrx
                        )

                        const requestedSeats = currentBooking.seatsReserved || []
                        const alreadyTaken = requestedSeats.filter((s: string) => availability.reservedSeats.includes(s))

                        if (alreadyTaken.length > 0) {
                            throw new Error(`E_SEATS_ALREADY_TAKEN: Les places suivantes sont déjà réservées sur ce trajet : ${alreadyTaken.join(', ')}`)
                        }
                    })
                }
            }
            // ------------------------------------------------------------------

            // Fetch wallets dynamically from related entities
            const driverWalletId = (intent as any).order?.driver?.walletId
            const companyWalletId = (intent as any).order?.company?.walletId
            const platformWalletId = process.env.WAVE_PLATFORM_WALLET_ID

            const splits: any[] = []

            // Fallback hierarchy logic for splits
            const driverAmount = intent.driverAmount || 0
            const companyAmount = intent.companyAmount || 0
            const platformFee = intent.platformFee || 0

            // Distribution buckets
            let finalDriverAmount = 0
            let finalCompanyAmount = 0
            let finalPlatformAmount = platformFee

            // 1. Handle Driver Amount
            if (driverWalletId) {
                finalDriverAmount = driverAmount
            } else if (companyWalletId) {
                finalCompanyAmount += driverAmount
            } else {
                finalPlatformAmount += driverAmount
            }

            // 2. Handle Company Amount
            if (companyWalletId) {
                finalCompanyAmount += companyAmount
            } else {
                finalPlatformAmount += companyAmount
            }

            // Build Splits
            if (finalDriverAmount > 0 && driverWalletId) {
                splits.push({
                    wallet_id: driverWalletId,
                    amount: finalDriverAmount,
                    category: 'DRIVER_PAYMENT',
                    label: `Rémunération livraison ${intent.orderId}`,
                    release_delay_hours: 0,
                })
            }

            if (finalCompanyAmount > 0 && companyWalletId) {
                splits.push({
                    wallet_id: companyWalletId,
                    amount: finalCompanyAmount,
                    category: 'COMPANY_COMMISSION',
                    label: `Commission entreprise ${intent.orderId}`,
                    release_delay_hours: 0,
                })
            }

            if (finalPlatformAmount > 0 && platformWalletId) {
                splits.push({
                    wallet_id: platformWalletId,
                    amount: finalPlatformAmount,
                    category: 'PLATFORM_COMMISSION',
                    label: `Commission/Reliquat plateforme ${intent.orderId}`,
                    release_delay_hours: 0,
                })
            }

            // Final safety check to ensure total sum matches Wave expectation
            const totalSplit = splits.reduce((sum, s) => sum + s.amount, 0)
            if (totalSplit !== intent.amount) {
                const diff = intent.amount - totalSplit
                if (diff > 0 && platformWalletId) {
                    const ps = splits.find(s => s.wallet_id === platformWalletId)
                    if (ps) ps.amount += diff
                    else splits.push({ wallet_id: platformWalletId, amount: diff, category: 'PLATFORM_COMMISSION', label: 'Ajustement plateforme' })
                } else if (diff !== 0) {
                    throw new Error(`Split sum mismatch: expected ${intent.amount}, got ${totalSplit}`)
                }
            }

            if (splits.length === 0 && intent.amount > 0) {
                throw new Error('No wallet splits configured')
            }

            const waveIntent = await walletBridge.createPaymentIntent({
                amount: intent.amount,
                externalReference: `${intent.id}`,
                description: `Paiement commande ${intent.orderId}`,
                successUrl: validated.successUrl,
                errorUrl: validated.errorUrl,
                splits,
            })

            intent.externalId = waveIntent.payment_intent_id
            await intent.useTransaction(effectiveTrx).save()

            if (!trx) await effectiveTrx.commit()

            logger.info({
                intentId: intent.id,
                externalId: intent.externalId,
            }, '[PaymentIntent] Authorized')

            return { checkoutUrl: waveIntent.wave_checkout_url || undefined }

        } catch (error) {
            if (!trx) await effectiveTrx.rollback()

            // Try to mark as FAILED in a SEPARATE transaction if the main one failed
            try {
                const failTrx = await db.transaction()
                const failIntent = await PaymentIntent.find(id, { client: failTrx })
                if (failIntent) {
                    failIntent.status = 'FAILED'
                    await failIntent.useTransaction(failTrx).save()
                    await failTrx.commit()
                }
            } catch (failErr) {
                logger.error({ failErr, id }, '[PaymentIntent] Failed to mark as FAILED')
            }
            throw error
        }
    }

    // ── Stop completed (progressive release) ──

    async onStopCompleted(stopId: string, trx?: TransactionClientContract): Promise<void> {
        const effectiveTrx = trx || await db.transaction()

        try {
            const intent = await (PaymentIntent as any).query({ client: effectiveTrx })
                .where('stop_id', stopId)
                .where('status', 'PENDING')
                .preload('order', (q: any) => q.preload('driver'))
                .first()

            if (!intent) {
                if (!trx) await effectiveTrx.commit()
                return
            }

            try {
                const driverWalletId = (intent as any).order?.driver?.walletId
                if (driverWalletId && intent.driverAmount > 0) {
                    await walletBridge.releaseFunds({
                        wallet_id: driverWalletId,
                        amount: intent.driverAmount,
                        label: `Release stop ${stopId}`,
                        external_reference: `stop_${stopId}`,
                    })
                }

                intent.status = 'COMPLETED'
                await intent.useTransaction(effectiveTrx).save()

                if (!trx) await effectiveTrx.commit()

                logger.info({
                    stopId,
                    amount: intent.amount,
                }, '[PaymentIntent] Stop payment released')
            } catch (error) {
                intent.status = 'FAILED'
                await intent.useTransaction(effectiveTrx).save()
                if (!trx) await effectiveTrx.commit()
                throw error
            }
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    // ── Payment Status Synchronization ──

    /**
     * Synchronise le statut d'un PaymentIntent avec les actions métier associées.
     * Appelé par le worker de synchro ou un éventuel webhook.
     */
    async syncIntentStatus(intentId: string, status: 'COMPLETED' | 'FAILED', trx?: TransactionClientContract): Promise<void> {
        const effectiveTrx = trx || await db.transaction()
        try {
            const intent = await PaymentIntent.query({ client: effectiveTrx })
                .where('id', intentId)
                .forUpdate()
                .firstOrFail()

            if (intent.status === status) {
                if (!trx) await effectiveTrx.commit()
                return
            }

            intent.status = status
            await intent.useTransaction(effectiveTrx).save()

            if (status === 'COMPLETED') {
                // Bonus actions specifically for Bookings
                if (intent.bookingId) {
                    const voyageService = new VoyageService()
                    const booking = await (await import('#models/booking')).default.query({ client: effectiveTrx })
                        .where('id', intent.bookingId)
                        .first()

                    if (booking) {
                        // FINAL SAFETY CHECK: Redis Lock & Segment Availability
                        await RedisLock.runWithLock(`voyage:${booking.orderId}:seats`, async () => {
                            const availability = await voyageService.getSeats(
                                booking.orderId,
                                booking.pickupStopId || undefined,
                                booking.dropoffStopId || undefined,
                                effectiveTrx
                            )

                            const requestedSeats = booking.seatsReserved || []
                            // Check if CONFIRMED bookings now occupy these seats
                            // (But we must ignore our own booking if it was already somehow in PENDING with seats)
                            // Actually VoyageService.getSeats already includes CONFIRMED + PENDING.
                            // To be absolutely safe, we check if seats are in availability.reservedSeats
                            // and if those reservations belong to CONFIRMED bookings other than ours.

                            const conflict = requestedSeats.filter((s: string) => availability.reservedSeats.includes(s))
                            if (conflict.length > 0) {
                                // Double check if it's REALLY a confirmed conflict
                                const conflictingConfirmed = await (await import('#models/booking')).default.query({ client: effectiveTrx })
                                    .where('order_id', booking.orderId)
                                    .where('status', 'CONFIRMED')
                                    .whereNot('id', booking.id)

                                const takenByConfirmed = conflictingConfirmed.flatMap((b: any) => b.seatsReserved || [])
                                const realStolen = requestedSeats.filter((s: string) => takenByConfirmed.includes(s))

                                if (realStolen.length > 0) {
                                    throw new Error(`E_FINAL_SEATS_CONFLICT: Désolé, les places ${realStolen.join(', ')} ont été confirmées par un autre paiement entre-temps.`)
                                }
                            }

                            booking.status = 'CONFIRMED'
                            await booking.useTransaction(effectiveTrx).save()
                            logger.info({ bookingId: booking.id, intentId }, '[PaymentIntent] Booking confirmed after successful payment')

                            // Emit event for real-time UI/Notifications
                            // TODO: Event.emit('payment:received', { bookingId: booking.id, amount: intent.amount })
                        })
                    }
                }
            }

            if (!trx) await effectiveTrx.commit()
            logger.info({ intentId, status }, '[PaymentIntent] Status synchronized')
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Récupère les intents en attente qui ont été initiés auprès de Wave.
     */
    async getPendingExternalIntents(limit = 20): Promise<PaymentIntent[]> {
        return PaymentIntent.query()
            .where('status', 'PENDING')
            .whereNotNull('externalId')
            .orderBy('created_at', 'asc')
            .limit(limit)
    }

    // ── Order delivered ──

    async onOrderDelivered(orderId: string, trx?: TransactionClientContract): Promise<void> {
        const intents = await (PaymentIntent as any).query({ client: trx })
            .where('order_id', orderId)
            .whereNot('status', 'COMPLETED')

        for (const intent of intents) {
            intent.status = 'COMPLETED'
            if (trx) {
                await intent.useTransaction(trx).save()
            } else {
                await intent.save()
            }
        }

        logger.info({ orderId, count: intents.length }, '[PaymentIntent] Order delivered - payment completed')
    }

    // ── COD ──

    async handleCod(id: string, user: User, data: any, trx?: TransactionClientContract): Promise<CodCollection> {
        const validated = await vine.validate({ schema: codSchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            const intent = await (PaymentIntent as any).query({ client: effectiveTrx })
                .where('id', id)
                .preload('order', (q: any) => q.preload('driver'))
                .forUpdate()
                .firstOrFail()

            if ((intent as any).order.driverId !== user.id) {
                throw new Error('Only the assigned driver can handle COD')
            }

            let settlementMode: SettlementMode = 'IMMEDIATE'
            let deferredReason: string | null = null
            let status: CodCollectionStatus = 'COLLECTED'

            const driverWalletId = (intent as any).order?.driver?.walletId

            if (driverWalletId) {
                try {
                    const balance = await walletBridge.getBalance(driverWalletId)
                    if (balance.available_balance < validated.collectedAmount) {
                        settlementMode = 'DEFERRED'
                        deferredReason = 'Solde insuffisant pour débit immédiat'
                        status = 'COD_DEFERRED'
                    }
                } catch {
                    settlementMode = 'DEFERRED'
                    deferredReason = 'Impossible de vérifier le solde'
                    status = 'COD_DEFERRED'
                }
            }

            const codCollection = await CodCollection.create({
                paymentIntentId: id,
                orderId: intent.orderId,
                driverId: user.id,
                stopId: validated.stopId || null,
                expectedAmount: validated.expectedAmount,
                collectedAmount: validated.collectedAmount,
                changeGiven: validated.changeGiven || 0,
                changeMethod: validated.changeMethod || null,
                clientWavePhone: validated.clientWavePhone || null,
                settlementMode,
                deferredReason,
                status,
                collectedAt: DateTime.now(),
                proofPhotoUrl: validated.proofPhotoUrl || null,
                notes: validated.notes || null,
            }, { client: effectiveTrx })

            if (settlementMode === 'IMMEDIATE' && driverWalletId) {
                try {
                    await this.settleCodFromDriverWallet(intent, codCollection, driverWalletId)
                    codCollection.status = 'SETTLED'
                    codCollection.settledAt = DateTime.now()
                    await codCollection.useTransaction(effectiveTrx).save()
                } catch (error) {
                    logger.error({ error, codId: codCollection.id }, '[PaymentIntent] Failed to settle COD immediately')
                    codCollection.settlementMode = 'DEFERRED'
                    codCollection.deferredReason = 'Débit wallet échoué'
                    codCollection.status = 'COD_DEFERRED'
                    await codCollection.useTransaction(effectiveTrx).save()
                }
            }

            intent.status = codCollection.status === 'SETTLED' ? 'COMPLETED' : 'PENDING'
            await intent.useTransaction(effectiveTrx).save()

            if (!trx) await effectiveTrx.commit()

            logger.info({
                codId: codCollection.id,
                settlementMode,
                amount: validated.collectedAmount,
            }, '[PaymentIntent] COD handled')

            return codCollection
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    // ── Refund ──

    async refund(id: string, _user: User, data: any, trx?: TransactionClientContract): Promise<void> {
        const validated = await vine.validate({ schema: refundSchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            const intent = await (PaymentIntent as any).query({ client: effectiveTrx })
                .where('id', id)
                .preload('order', (q: any) => q.preload('client'))
                .forUpdate()
                .firstOrFail()

            const clientWalletId = (intent as any).order?.client?.walletId

            if (clientWalletId && intent.amount > 0) {
                await walletBridge.refund({
                    wallet_id: clientWalletId,
                    amount: intent.amount,
                    reason: validated.reason || `Remboursement commande ${intent.orderId}`,
                    external_reference: `refund_${intent.orderId}`,
                })
            }

            intent.status = 'REFUNDED'
            await intent.useTransaction(effectiveTrx).save()

            if (!trx) await effectiveTrx.commit()

            logger.info({ paymentIntentId: id, amount: intent.amount }, '[PaymentIntent] Refunded')
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    // ── Settle deferred COD (batch/cron) ──

    async settlePendingCod(): Promise<{ settled: number; failed: number; total: number }> {
        const deferred = await (CodCollection as any).query()
            .where('status', 'COD_DEFERRED')
            .preload('paymentIntent', (q: any) => q.preload('order', (o: any) => o.preload('driver')))
            .exec()

        let settled = 0
        let failed = 0

        for (const cod of deferred) {
            try {
                const driverWalletId = cod.paymentIntent?.order?.driver?.walletId
                if (!driverWalletId) throw new Error('Driver wallet missing')

                await this.settleCodFromDriverWallet(cod.paymentIntent, cod, driverWalletId)
                cod.status = 'SETTLED'
                cod.settledAt = DateTime.now()
                await cod.save()

                cod.paymentIntent.status = 'COMPLETED'
                await cod.paymentIntent.save()

                settled++
            } catch (error) {
                logger.error({ codId: cod.id, error }, '[PaymentIntent] Failed to settle deferred COD')
                failed++
            }
        }

        logger.info({ settled, failed, total: deferred.length }, '[PaymentIntent] Deferred COD settlement batch')
        return { settled, failed, total: deferred.length }
    }

    // ── Private ──

    private async settleCodFromDriverWallet(intent: PaymentIntent, cod: CodCollection, driverWalletId: string): Promise<void> {
        const platformWalletId = process.env.WAVE_PLATFORM_WALLET_ID

        if (!driverWalletId || !platformWalletId) return

        const splits: Array<{
            wallet_id: string
            amount: number
            category: 'COD_SETTLEMENT'
            label: string
        }> = []
        await (intent as any).load('order', (q: any) => q.preload('company'))
        const companyWalletId = (intent as any).order?.company?.walletId

        if (platformWalletId && intent.platformFee > 0) {
            splits.push({
                wallet_id: platformWalletId,
                amount: intent.platformFee,
                category: 'COD_SETTLEMENT',
                label: `Règlement COD - commission plateforme ${intent.orderId}`,
            })
        }

        if (companyWalletId && intent.companyAmount > 0) {
            splits.push({
                wallet_id: companyWalletId,
                amount: intent.companyAmount,
                category: 'COD_SETTLEMENT',
                label: `Règlement COD - commission entreprise ${intent.orderId}`,
            })
        }

        if (splits.length > 0) {
            const totalToTransfer = splits.reduce((s, sp) => s + sp.amount, 0)
            await walletBridge.createInternalTransfer({
                payer_wallet_id: driverWalletId,
                amount: totalToTransfer,
                description: `Règlement COD commande ${intent.orderId}`,
                external_reference: `cod_${cod.id}`,
                splits,
            })
        }
    }

    calculateSplits(
        intent: { amount: number, calculatedAmount?: number, bookingId?: string | null },
        policy: PaymentPolicy | null,
        companyId?: string | null,
        rates?: {
            template?: string | null
            commandeCommissionPercent?: number
            ticketFeePercent?: number
            waveFeeBps?: number
            waveEstimatedFee?: number
        }
    ): PaymentSplits {
        const totalAmount = intent.amount

        // 1. Déterminer les parts cibles (en %)
        const template = String(rates?.template || '').toUpperCase()
        const dynamicCommandePercent = rates?.commandeCommissionPercent ?? DEFAULT_COMMANDE_COMMISSION_PERCENT
        const dynamicTicketPercent = rates?.ticketFeePercent ?? DEFAULT_TICKET_FEE_PERCENT
        const dynamicPercent =
            template === 'COMMANDE' ? dynamicCommandePercent : template === 'VOYAGE' && intent.bookingId ? dynamicTicketPercent : 0

        let platformTargetPercent = 0
        if (!policy?.platformCommissionExempt) {
            platformTargetPercent = (policy?.platformCommissionPercent ?? 5) + dynamicPercent
        }
        const companyTargetPercent = policy?.companyCommissionPercent ?? 0

        // 2. Ticket Markup (Specific for VOYAGE Bookings)
        let ticketMarkupAmount = 0
        if (intent.bookingId && policy && policy.ticketMarkupPercent) {
            ticketMarkupAmount = Math.round((intent.calculatedAmount || totalAmount) * policy.ticketMarkupPercent / 100)
        }

        // 3. Calculer les montants bruts (avant frais Wave)
        const platformGross = (platformTargetPercent > 0 || policy?.platformCommissionFixed)
            ? Math.round((intent.calculatedAmount || totalAmount) * platformTargetPercent / 100) + (policy?.platformCommissionFixed ?? 0)
            : 0
        const totalPlatformGross = platformGross + ticketMarkupAmount

        const companyGross = companyId ? Math.round((intent.calculatedAmount || totalAmount) * companyTargetPercent / 100) + (policy?.companyCommissionFixed ?? 0) : 0

        // 4. Appliquer les frais Wave au prorata sur chaque acteur
        const waveFeeBps = Number.isFinite(Number(rates?.waveFeeBps)) ? Math.max(0, Math.floor(Number(rates?.waveFeeBps))) : this.fallbackWaveFeeBps
        const computedWaveFee = Math.ceil((totalAmount * waveFeeBps) / 10000)
        const waveFeeRaw = rates?.waveEstimatedFee ?? computedWaveFee
        const waveFee = Math.max(0, Math.min(totalAmount, Math.floor(Number(waveFeeRaw) || 0)))
        const totalNet = Math.max(0, totalAmount - waveFee)
        const netFactor = totalAmount > 0 ? totalNet / totalAmount : 1

        const platformAmount = Math.round(totalPlatformGross * netFactor)
        const companyAmount = Math.round(companyGross * netFactor)
        const driverAmount = Math.max(0, totalNet - platformAmount - companyAmount)

        return {
            platformAmount,
            companyAmount,
            driverAmount,
            totalNet,
            waveFee
        }
    }
}

export default new OrderPaymentService()
