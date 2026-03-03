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
import walletBridge from '#services/wallet_bridge_service'
import type { CodCollectionStatus, SettlementMode } from '#models/cod_collection'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

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
const SUBLYMUS_COMMISSION_PERCENT = 1
const WAVE_FEE_PERCENT = 1

class OrderPaymentService {
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

                    const splits = this.calculateSplits({ amount, bookingId: booking.id, calculatedAmount: amount }, policy, order.companyId)

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

                            const splits = this.calculateSplits({ amount: amnt, calculatedAmount: calcAmnt }, policy, order.companyId)

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
                    const splits = this.calculateSplits({ amount: totalAmount, calculatedAmount }, policy, order.companyId)

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
                .preload('order', (q: any) => {
                    q.preload('driver')
                    q.preload('company')
                })
                .forUpdate()
                .firstOrFail()

            // Fetch wallets dynamically from related entities
            const driverWalletId = (intent as any).order?.driver?.walletId
            const companyWalletId = (intent as any).order?.company?.walletId
            const platformWalletId = process.env.WAVE_PLATFORM_WALLET_ID

            const splits = []

            if (driverWalletId && intent.driverAmount > 0) {
                splits.push({
                    wallet_id: driverWalletId,
                    amount: intent.driverAmount,
                    category: 'DRIVER_PAYMENT',
                    label: `Rémunération livraison ${intent.orderId}`,
                    release_delay_hours: 0,
                })
            }

            if (companyWalletId && intent.companyAmount > 0) {
                splits.push({
                    wallet_id: companyWalletId,
                    amount: intent.companyAmount,
                    category: 'COMPANY_COMMISSION',
                    label: `Commission entreprise ${intent.orderId}`,
                    release_delay_hours: 0,
                })
            }

            if (platformWalletId && intent.platformFee > 0) {
                splits.push({
                    wallet_id: platformWalletId,
                    amount: intent.platformFee,
                    category: 'PLATFORM_COMMISSION',
                    label: `Commission plateforme ${intent.orderId}`,
                    release_delay_hours: 0,
                })
            }

            if (splits.length === 0 && intent.amount > 0) {
                throw new Error('No wallet splits configured')
            }

            try {
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

        const splits = []
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

    calculateSplits(intent: { amount: number, calculatedAmount?: number, bookingId?: string | null }, policy: PaymentPolicy | null, companyId?: string | null): PaymentSplits {
        const totalAmount = intent.amount

        // 1. Déterminer les parts cibles (en %)
        let platformTargetPercent = 0
        if (!policy?.platformCommissionExempt) {
            platformTargetPercent = (policy?.platformCommissionPercent ?? 5) + SUBLYMUS_COMMISSION_PERCENT
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

        // 4. Appliquer la réduction de 1% (frais Wave) au prorata sur chaque acteur
        const waveFactor = (1 - WAVE_FEE_PERCENT / 100)
        const platformAmount = Math.round(totalPlatformGross * waveFactor)
        const companyAmount = Math.round(companyGross * waveFactor)

        const totalNet = Math.round(totalAmount * waveFactor)
        const driverAmount = Math.max(0, totalNet - platformAmount - companyAmount)

        return {
            platformAmount,
            companyAmount,
            driverAmount,
            totalNet,
            waveFee: totalAmount - totalNet
        }
    }
}

export default new OrderPaymentService()
