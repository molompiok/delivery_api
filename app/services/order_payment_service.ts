import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import vine from '@vinejs/vine'
import Order from '#models/order'
import OrderPayment from '#models/order_payment'
import StopPayment from '#models/stop_payment'
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

const initiateSchema = vine.object({
    orderId: vine.string(),
    totalAmount: vine.number().min(0),
    driverId: vine.string().optional(),
    companyId: vine.string().optional(),
    clientWalletId: vine.string().optional(),
    driverWalletId: vine.string().optional(),
    companyWalletId: vine.string().optional(),
    platformWalletId: vine.string().optional(),
    domain: vine.string().optional(),
})

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

class OrderPaymentService {

    // ── Find ──

    async findById(id: string, user: User, trx?: TransactionClientContract): Promise<OrderPayment> {
        const payment = await OrderPayment.query({ client: trx })
            .where('id', id)
            .preload('stopPayments')
            .preload('codCollection')
            .firstOrFail()

        // Vérifier que l'user est lié à la commande
        const order = await Order.query({ client: trx }).where('id', payment.orderId).firstOrFail()
        if (order.clientId !== user.id && order.driverId !== user.id) {
            const companyId = user.currentCompanyManaged || user.companyId
            if (!companyId) throw new Error('Not authorized to access this payment')
        }

        return payment
    }

    async getByOrder(orderId: string, trx?: TransactionClientContract): Promise<OrderPayment | null> {
        return OrderPayment.query({ client: trx })
            .where('order_id', orderId)
            .preload('stopPayments')
            .preload('codCollection')
            .first()
    }

    // ── Initiate ──

    async initiate(user: User, data: any, trx?: TransactionClientContract): Promise<OrderPayment> {
        const validated = await vine.validate({ schema: initiateSchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            // Vérifier que l'order appartient à l'user
            const order = await Order.query({ client: effectiveTrx })
                .where('id', validated.orderId)
                .firstOrFail()

            if (order.clientId !== user.id) {
                const companyId = user.currentCompanyManaged || user.companyId
                if (!companyId) throw new Error('Not authorized to initiate payment for this order')
            }

            // Résoudre la politique applicable
            const policy = await paymentPolicyService.resolve(
                validated.driverId, validated.companyId, validated.domain, effectiveTrx
            )

            // Calculer les splits selon la politique
            const platformPercent = policy?.platformCommissionPercent ?? 5
            const platformFixed = policy?.platformCommissionFixed ?? 0
            const companyPercent = policy?.companyCommissionPercent ?? 0
            const companyFixed = policy?.companyCommissionFixed ?? 0

            const totalAmount = validated.totalAmount
            const platformAmount = Math.round(totalAmount * platformPercent / 100) + platformFixed
            const companyAmount = validated.companyId ? Math.round(totalAmount * companyPercent / 100) + companyFixed : 0
            const driverAmount = totalAmount - platformAmount - companyAmount

            const orderPayment = await OrderPayment.create({
                orderId: validated.orderId,
                paymentPolicyId: policy?.id || null,
                totalAmount,
                driverAmount: Math.max(0, driverAmount),
                companyAmount,
                platformAmount,
                clientWalletId: validated.clientWalletId || null,
                driverWalletId: validated.driverWalletId || null,
                companyWalletId: validated.companyWalletId || null,
                platformWalletId: validated.platformWalletId || null,
                paymentStatus: 'PENDING',
                paidAmount: 0,
                remainingAmount: totalAmount,
                codAmount: null,
                codStatus: 'NONE',
            }, { client: effectiveTrx })

            // Si PROGRESSIVE, créer un StopPayment par stop
            if (policy?.clientPaymentTrigger === 'PROGRESSIVE') {
                await this.createStopPayments(orderPayment, effectiveTrx)
            }

            if (!trx) await effectiveTrx.commit()

            logger.info({
                orderPaymentId: orderPayment.id,
                orderId: validated.orderId,
                totalAmount,
                driverAmount: orderPayment.driverAmount,
                platformAmount,
                companyAmount,
                trigger: policy?.clientPaymentTrigger,
            }, '[OrderPayment] Initiated')

            return orderPayment
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
            const payment = await OrderPayment.query({ client: effectiveTrx })
                .where('id', id)
                .forUpdate()
                .firstOrFail()

            // Construire les splits pour wave-api
            const splits = []

            if (payment.driverWalletId && payment.driverAmount > 0) {
                splits.push({
                    wallet_id: payment.driverWalletId,
                    amount: payment.driverAmount,
                    category: 'DRIVER_PAYMENT',
                    label: `Rémunération livraison ${payment.orderId}`,
                    release_delay_hours: 0,
                })
            }

            if (payment.companyWalletId && payment.companyAmount > 0) {
                splits.push({
                    wallet_id: payment.companyWalletId,
                    amount: payment.companyAmount,
                    category: 'COMPANY_COMMISSION',
                    label: `Commission entreprise ${payment.orderId}`,
                    release_delay_hours: 0,
                })
            }

            if (payment.platformWalletId && payment.platformAmount > 0) {
                splits.push({
                    wallet_id: payment.platformWalletId,
                    amount: payment.platformAmount,
                    category: 'PLATFORM_COMMISSION',
                    label: `Commission plateforme ${payment.orderId}`,
                    release_delay_hours: 0,
                })
            }

            if (splits.length === 0) {
                throw new Error('No wallet splits configured')
            }

            try {
                const intent = await walletBridge.createPaymentIntent({
                    amount: payment.totalAmount,
                    externalReference: `order_${payment.orderId}`,
                    description: `Paiement commande ${payment.orderId}`,
                    successUrl: validated.successUrl,
                    errorUrl: validated.errorUrl,
                    splits,
                })

                payment.paymentIntentId = intent.payment_intent_id
                payment.paymentStatus = 'AUTHORIZED'
                await payment.useTransaction(effectiveTrx).save()

                if (!trx) await effectiveTrx.commit()

                logger.info({
                    orderPaymentId: payment.id,
                    intentId: intent.payment_intent_id,
                }, '[OrderPayment] Authorized')

                return { checkoutUrl: intent.wave_checkout_url || undefined }
            } catch (error) {
                payment.paymentStatus = 'FAILED'
                await payment.useTransaction(effectiveTrx).save()
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
            const stopPayment = await StopPayment.query({ client: effectiveTrx })
                .where('stop_id', stopId)
                .where('status', 'PENDING')
                .first()

            if (!stopPayment) {
                if (!trx) await effectiveTrx.commit()
                return
            }

            const orderPayment = await OrderPayment.query({ client: effectiveTrx })
                .where('id', stopPayment.orderPaymentId)
                .forUpdate()
                .firstOrFail()

            try {
                if (orderPayment.driverWalletId && stopPayment.amount > 0) {
                    await walletBridge.releaseFunds({
                        wallet_id: orderPayment.driverWalletId,
                        amount: stopPayment.amount,
                        label: `Release stop ${stopId}`,
                        external_reference: `stop_${stopId}`,
                    })
                }

                stopPayment.status = 'PAID'
                stopPayment.paidAt = DateTime.now()
                await stopPayment.useTransaction(effectiveTrx).save()

                orderPayment.paidAmount += stopPayment.amount
                orderPayment.remainingAmount -= stopPayment.amount
                orderPayment.paymentStatus = orderPayment.remainingAmount <= 0 ? 'COMPLETED' : 'PARTIAL'
                await orderPayment.useTransaction(effectiveTrx).save()

                if (!trx) await effectiveTrx.commit()

                logger.info({
                    stopId,
                    amount: stopPayment.amount,
                    remaining: orderPayment.remainingAmount,
                }, '[OrderPayment] Stop payment released')
            } catch (error) {
                stopPayment.status = 'FAILED'
                await stopPayment.useTransaction(effectiveTrx).save()
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
        const orderPayment = await OrderPayment.query({ client: trx })
            .where('order_id', orderId)
            .first()

        if (!orderPayment) return
        if (orderPayment.paymentStatus === 'COMPLETED') return

        orderPayment.paymentStatus = 'COMPLETED'
        orderPayment.paidAmount = orderPayment.totalAmount
        orderPayment.remainingAmount = 0
        if (trx) {
            await orderPayment.useTransaction(trx).save()
        } else {
            await orderPayment.save()
        }

        logger.info({ orderId, orderPaymentId: orderPayment.id }, '[OrderPayment] Order delivered - payment completed')
    }

    // ── COD ──

    async handleCod(id: string, user: User, data: any, trx?: TransactionClientContract): Promise<CodCollection> {
        const validated = await vine.validate({ schema: codSchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            const orderPayment = await OrderPayment.query({ client: effectiveTrx })
                .where('id', id)
                .forUpdate()
                .firstOrFail()

            // Vérifier que l'user est bien le driver de cette commande
            const order = await Order.query({ client: effectiveTrx }).where('id', orderPayment.orderId).firstOrFail()
            if (order.driverId !== user.id) {
                throw new Error('Only the assigned driver can handle COD')
            }

            // Déterminer le mode de règlement
            let settlementMode: SettlementMode = 'IMMEDIATE'
            let deferredReason: string | null = null
            let status: CodCollectionStatus = 'COLLECTED'

            if (orderPayment.driverWalletId) {
                try {
                    const balance = await walletBridge.getBalance(orderPayment.driverWalletId)
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
                orderPaymentId: id,
                orderId: orderPayment.orderId,
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

            // Si IMMEDIATE, débiter le wallet du driver maintenant
            if (settlementMode === 'IMMEDIATE' && orderPayment.driverWalletId) {
                try {
                    await this.settleCodFromDriverWallet(orderPayment, codCollection)
                    codCollection.status = 'SETTLED' as any
                    codCollection.settledAt = DateTime.now()
                    await codCollection.useTransaction(effectiveTrx).save()
                } catch (error) {
                    logger.error({ error, codId: codCollection.id }, '[OrderPayment] Failed to settle COD immediately')
                    codCollection.settlementMode = 'DEFERRED'
                    codCollection.deferredReason = 'Débit wallet échoué'
                    codCollection.status = 'COD_DEFERRED'
                    await codCollection.useTransaction(effectiveTrx).save()
                }
            }

            // Mettre à jour le statut COD de l'OrderPayment
            orderPayment.codAmount = validated.collectedAmount
            orderPayment.codStatus = codCollection.status === ('SETTLED' as any) ? 'DEPOSITED' : 'COLLECTED'
            orderPayment.paymentStatus = codCollection.status === ('SETTLED' as any) ? 'COD_COLLECTED' : 'COD_DEFERRED'
            await orderPayment.useTransaction(effectiveTrx).save()

            if (!trx) await effectiveTrx.commit()

            logger.info({
                codId: codCollection.id,
                settlementMode,
                amount: validated.collectedAmount,
            }, '[OrderPayment] COD handled')

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
            const payment = await OrderPayment.query({ client: effectiveTrx })
                .where('id', id)
                .forUpdate()
                .firstOrFail()

            if (payment.clientWalletId && payment.paidAmount > 0) {
                await walletBridge.refund({
                    wallet_id: payment.clientWalletId,
                    amount: payment.paidAmount,
                    reason: validated.reason || `Remboursement commande ${payment.orderId}`,
                    external_reference: `refund_${payment.orderId}`,
                })
            }

            payment.paymentStatus = 'REFUNDED'
            await payment.useTransaction(effectiveTrx).save()

            if (!trx) await effectiveTrx.commit()

            logger.info({ orderPaymentId: id, amount: payment.paidAmount }, '[OrderPayment] Refunded')
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    // ── Settle deferred COD (batch/cron) ──

    async settlePendingCod(): Promise<{ settled: number; failed: number; total: number }> {
        const deferred = await CodCollection.query()
            .where('status', 'COD_DEFERRED')
            .preload('orderPayment')
            .exec()

        let settled = 0
        let failed = 0

        for (const cod of deferred) {
            try {
                await this.settleCodFromDriverWallet(cod.orderPayment, cod)
                cod.status = 'SETTLED'
                cod.settledAt = DateTime.now()
                await cod.save()

                cod.orderPayment.codStatus = 'DEPOSITED'
                cod.orderPayment.paymentStatus = 'COD_COLLECTED'
                await cod.orderPayment.save()

                settled++
            } catch (error) {
                logger.error({ codId: cod.id, error }, '[OrderPayment] Failed to settle deferred COD')
                failed++
            }
        }

        logger.info({ settled, failed, total: deferred.length }, '[OrderPayment] Deferred COD settlement batch')
        return { settled, failed, total: deferred.length }
    }

    // ── Private ──

    private async createStopPayments(orderPayment: OrderPayment, trx?: TransactionClientContract): Promise<void> {
        const order = await Order.query({ client: trx })
            .where('id', orderPayment.orderId)
            .preload('stops')
            .firstOrFail()

        const stops = order.stops.sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0))

        if (stops.length === 0) return

        const amountPerStop = Math.floor(orderPayment.totalAmount / stops.length)
        const remainder = orderPayment.totalAmount - (amountPerStop * stops.length)

        for (let i = 0; i < stops.length; i++) {
            const amount = i === stops.length - 1 ? amountPerStop + remainder : amountPerStop

            await StopPayment.create({
                orderPaymentId: orderPayment.id,
                stopId: stops[i].id,
                amount,
                status: 'PENDING',
            }, { client: trx })
        }

        logger.info({
            orderPaymentId: orderPayment.id,
            stopsCount: stops.length,
        }, '[OrderPayment] StopPayments created')
    }

    private async settleCodFromDriverWallet(orderPayment: OrderPayment, cod: CodCollection): Promise<void> {
        if (!orderPayment.driverWalletId || !orderPayment.platformWalletId) return

        const splits = []

        if (orderPayment.platformWalletId && orderPayment.platformAmount > 0) {
            splits.push({
                wallet_id: orderPayment.platformWalletId,
                amount: orderPayment.platformAmount,
                category: 'COD_SETTLEMENT',
                label: `Règlement COD - commission plateforme ${orderPayment.orderId}`,
            })
        }

        if (orderPayment.companyWalletId && orderPayment.companyAmount > 0) {
            splits.push({
                wallet_id: orderPayment.companyWalletId,
                amount: orderPayment.companyAmount,
                category: 'COD_SETTLEMENT',
                label: `Règlement COD - commission entreprise ${orderPayment.orderId}`,
            })
        }

        if (splits.length > 0) {
            const totalToTransfer = splits.reduce((s, sp) => s + sp.amount, 0)
            await walletBridge.createInternalTransfer({
                payer_wallet_id: orderPayment.driverWalletId,
                amount: totalToTransfer,
                description: `Règlement COD commande ${orderPayment.orderId}`,
                external_reference: `cod_${cod.id}`,
                splits,
            })
        }
    }
}

export default new OrderPaymentService()
