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
import paymentCheckoutCacheService from '#services/payment_checkout_cache_service'
import paymentWalletResolutionService, {
  type ResolvedPaymentWallets,
} from '#services/payment_wallet_resolution_service'
import type { CodCollectionStatus, SettlementMode } from '#models/cod_collection'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import RedisLock from '#utils/redis_lock'
import VoyageService from '#services/voyage_service'
import WsService from '#services/ws_service'

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
  successUrl: vine.string().url().optional(),
  errorUrl: vine.string().url().optional(),
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
const PENDING_BOOKING_HOLD_MINUTES = 5

interface WaveFeeEstimate {
  feeBps: number
  estimatedFee: number
  totalDebit: number
}

class OrderPaymentService {
  private readonly waveFeeCache = new Map<number, WaveFeeEstimate>()

  private async resolveWalletsForIntent(
    intent: PaymentIntent,
    trx?: TransactionClientContract
  ): Promise<ResolvedPaymentWallets> {
    return paymentWalletResolutionService.resolveForOrder(intent.orderId, trx)
  }

  private buildExternalPaymentSplits(
    intent: PaymentIntent,
    wallets: ResolvedPaymentWallets
  ): Array<{
    wallet_id: string
    amount: number
    category: 'DRIVER_PAYMENT' | 'COMPANY_COMMISSION' | 'PLATFORM_COMMISSION'
    label: string
    release_delay_hours: number
  }> {
    const driverAmount = intent.driverAmount || 0
    const companyAmount = intent.companyAmount || 0
    const platformAmount = (intent.platformFee || 0) + (intent.waveFee || 0)
    const driverDestinationWalletId = wallets.companyId
      ? wallets.companyDriverWalletId
      : wallets.driverWalletId

    if (driverAmount > 0 && !driverDestinationWalletId) {
      if (wallets.companyId) {
        throw new Error(`Company-driver wallet not configured for order ${intent.orderId}`)
      }
      throw new Error(`Driver wallet not configured for order ${intent.orderId}`)
    }

    if (companyAmount > 0 && !wallets.companyWalletId) {
      throw new Error(`Company wallet not configured for order ${intent.orderId}`)
    }

    if (platformAmount > 0 && !wallets.platformWalletId) {
      throw new Error('Platform wallet not configured')
    }

    const splits: Array<{
      wallet_id: string
      amount: number
      category: 'DRIVER_PAYMENT' | 'COMPANY_COMMISSION' | 'PLATFORM_COMMISSION'
      label: string
      release_delay_hours: number
    }> = []

    if (driverAmount > 0) {
      splits.push({
        wallet_id: driverDestinationWalletId!,
        amount: driverAmount,
        category: 'DRIVER_PAYMENT',
        label: `Remuneration livraison ${intent.orderId}`,
        release_delay_hours: 0,
      })
    }

    if (companyAmount > 0) {
      splits.push({
        wallet_id: wallets.companyWalletId!,
        amount: companyAmount,
        category: 'COMPANY_COMMISSION',
        label: `Commission entreprise ${intent.orderId}`,
        release_delay_hours: 0,
      })
    }

    if (platformAmount > 0) {
      splits.push({
        wallet_id: wallets.platformWalletId!,
        amount: platformAmount,
        category: 'PLATFORM_COMMISSION',
        label: `Commission plateforme et frais Wave ${intent.orderId}`,
        release_delay_hours: 0,
      })
    }

    const totalSplit = splits.reduce((sum, split) => sum + split.amount, 0)
    if (totalSplit !== intent.amount) {
      throw new Error(
        `Split sum mismatch for order ${intent.orderId}: expected ${intent.amount}, got ${totalSplit}`
      )
    }

    return splits
  }

  private getCodSettlementBlockingReason(
    intent: PaymentIntent,
    wallets: ResolvedPaymentWallets
  ): string | null {
    const totalSettlementAmount = (intent.platformFee || 0) + (intent.companyAmount || 0)
    const settlementPayerWalletId = wallets.companyId
      ? wallets.companyDriverWalletId
      : wallets.driverWalletId

    if (totalSettlementAmount > 0 && !settlementPayerWalletId) {
      if (wallets.companyId) {
        return 'Wallet entreprise-driver introuvable'
      }
      return 'Wallet driver introuvable'
    }

    if (wallets.companyId && totalSettlementAmount > 0 && !wallets.companyDriverWalletId) {
      return 'Wallet entreprise-driver introuvable'
    }

    if ((intent.platformFee || 0) > 0 && !wallets.platformWalletId) {
      return 'Wallet plateforme introuvable'
    }

    if ((intent.companyAmount || 0) > 0 && !wallets.companyWalletId) {
      return 'Wallet entreprise introuvable'
    }

    return null
  }

  private getPendingHoldAnchor(booking: any) {
    return booking?.updatedAt || booking?.createdAt
  }

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
      logger.warn(
        { amount: normalized, error: error?.message },
        '[PaymentIntent] Failed to fetch Wave payout fee estimate, fallback to local'
      )
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

  async search(
    params: { orderId?: string; bookingId?: string; stopId?: string },
    trx?: TransactionClientContract
  ): Promise<PaymentIntent[]> {
    const query = PaymentIntent.query({ client: trx }).preload('codCollections', (q) =>
      q.orderBy('created_at', 'desc')
    )

    if (params.orderId) {
      query.where('orderId', params.orderId)
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

  async generateIntentsForOrder(
    order: Order,
    trx?: TransactionClientContract
  ): Promise<PaymentIntent[]> {
    const effectiveTrx = trx || (await db.transaction())
    try {
      // Mission/Intervention flows are intentionally non-billable in this refactor.
      if (order.template === 'MISSION') {
        if (!trx) await effectiveTrx.commit()
        logger.info(
          { orderId: order.id, template: order.template },
          '[PaymentIntent] Skipped for mission order'
        )
        return []
      }

      await (order as any).load('stops')
      if (order.template === 'VOYAGE') {
        await (order as any).load('bookings', (bookingQuery: any) => {
          bookingQuery.preload('transitItems')
        })
      }

      const policy = await paymentPolicyService.resolve(
        order.driverId,
        order.companyId,
        order.template,
        effectiveTrx
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
          const amount = transitItems.reduce(
            (sum: number, item: any) => sum + (item.unitaryPrice || 0),
            0
          )

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

          const intent = await PaymentIntent.create(
            {
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
            },
            { client: effectiveTrx }
          )
          intents.push(intent)
          existingBookingIntentIds.add(String(booking.id))
        }
      } else {
        // Pour COMMANDE: Payeur = Client
        const pricingData = order.pricingData as any
        const totalAmount = pricingData?.clientFee || 0
        const calculatedAmount = pricingData?.calculatedAmount || totalAmount
        const isPriceOverridden = pricingData?.isPriceOverridden || false

        const effectiveTrigger = order.paymentTrigger || policy?.clientPaymentTrigger
        if (effectiveTrigger === 'PROGRESSIVE') {
          // Paiement progressif : un intent par stop (livraison)
          // EXPLICATION DU COMPROMIS METIER (PROGRESSIVE PAYMENT SPLIT) :
          // Idéalement, la facturation devrait se faire par colis (TransitItem) selon son propre segment kilométrique,
          // et être réclamée au point de dépôt de ce colis spécifique.
          // Pour l'instant (approche simplifiée), nous prenons le coût total de la commande
          // et nous le divisons équitablement uniquement entre les arrêts de *dépôt* (DELIVERY/SERVICE).
          // Cela évite l'absurdité de facturer le client lors d'un simple ramassage (PICKUP).

          await (order as any).load('stops', (stopsQuery: any) => {
            stopsQuery.preload('actions')
          })

          const allStops = order.stops.sort(
            (a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0)
          )

          // On ne garde que les arrêts qui impliquent formellement un dépôt ou un service rendu au client final
          const deliveryStops = allStops.filter((stop) => {
            if (!stop.actions) return false;
            return stop.actions.some((action: any) =>
              action.type === 'DELIVERY' || action.type === 'SERVICE'
            );
          });

          // Fallback au cas où aucun arrêt n'est catégorisé comme DELIVERY (ex: bug de création)
          const targetStops = deliveryStops.length > 0 ? deliveryStops : allStops;

          if (targetStops.length > 0) {
            const amountPerStop = Math.floor(totalAmount / targetStops.length)
            const calculatedAmountPerStop = Math.floor(calculatedAmount / targetStops.length)
            const remainder = totalAmount - amountPerStop * targetStops.length

            for (let i = 0; i < targetStops.length; i++) {
              const amnt = i === targetStops.length - 1 ? amountPerStop + remainder : amountPerStop
              const calcAmnt =
                i === targetStops.length - 1
                  ? calculatedAmountPerStop +
                  (calculatedAmount - calculatedAmountPerStop * targetStops.length)
                  : calculatedAmountPerStop

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

              const intent = await PaymentIntent.create(
                {
                  orderId: order.id,
                  stopId: targetStops[i].id,
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
                },
                { client: effectiveTrx }
              )
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

          const intent = await PaymentIntent.create(
            {
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
            },
            { client: effectiveTrx }
          )
          intents.push(intent)
        }
      }

      if (!trx) await effectiveTrx.commit()

      logger.info(
        { orderId: order.id, count: intents.length },
        '[PaymentIntent] Generated for order'
      )
      return intents
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }

  // ── Authorize ──

  async authorize(
    id: string,
    _user: User,
    data: any,
    trx?: TransactionClientContract
  ): Promise<{ checkoutUrl?: string }> {
    const validated = await vine.validate({ schema: authorizeSchema, data })
    const effectiveTrx = trx || (await db.transaction())

    try {
      const callbackBase = String(
        process.env.WAVE_CALLBACK_BASE_URL || process.env.PUBLIC_APP_URL || 'https://sublymus.com'
      ).replace(/\/+$/, '')
      const successUrl = validated.successUrl || `${callbackBase}/payments/success`
      const errorUrl = validated.errorUrl || `${callbackBase}/payments/error`

      const intent = await (PaymentIntent as any)
        .query({ client: effectiveTrx })
        .where('id', id)
        .preload('booking')
        .preload('order', (q: any) => {
          q.preload('driver')
          q.preload('company')
          q.preload('bookings', (bq: any) => bq.where('status', 'CONFIRMED'))
        })
        .forUpdate()
        .firstOrFail()

      if (intent.status !== 'PENDING') {
        throw new Error(`Payment intent ${intent.id} is not payable anymore (status=${intent.status})`)
      }

      const cachedCheckout = await paymentCheckoutCacheService.get(intent.id)
      if (cachedCheckout && (!intent.externalId || intent.externalId === cachedCheckout.externalId)) {
        if (intent.externalId !== cachedCheckout.externalId) {
          intent.externalId = cachedCheckout.externalId
          await intent.useTransaction(effectiveTrx).save()
        }

        if (!trx) await effectiveTrx.commit()
        logger.info({ intentId: intent.id }, '[PaymentIntent] Reusing cached checkout URL')
        return { checkoutUrl: cachedCheckout.checkoutUrl }
      }

      // --- PRE-PAYMENT VALIDATIONS (Segment Aware & Concurrent Safe) ---
      const order = intent.order
      if (order && order.template === 'VOYAGE') {
        const voyageService = new VoyageService()

        // 1. Check Voyage Status
        if (order.status !== 'PUBLISHED') {
          throw new Error(
            "E_VOYAGE_NOT_AVAILABLE: Ce voyage n'est plus disponible (déjà parti ou annulé)."
          )
        }

        // 2. Check Seat Availability with Redis Lock
        if (intent.bookingId) {
          await RedisLock.runWithLock(`voyage:${order.id}:seats`, async () => {
            const currentBooking = intent.booking
            if (!currentBooking) return
            const holdAnchor = this.getPendingHoldAnchor(currentBooking)
            const holdExpiresAt = holdAnchor?.plus({
              minutes: PENDING_BOOKING_HOLD_MINUTES,
            })

            if (holdExpiresAt && holdExpiresAt.toMillis() <= DateTime.now().toMillis()) {
              throw new Error(
                'E_BOOKING_HOLD_EXPIRED: Cette reservation a expire apres 5 minutes. Merci de relancer votre reservation.'
              )
            }

            // Precise segment availability check
            const availability = await voyageService.getSeats(
              order.id,
              currentBooking.pickupStopId || undefined,
              currentBooking.dropoffStopId || undefined,
              effectiveTrx,
              { excludeBookingId: currentBooking.id }
            )

            const requestedSeats = currentBooking.seatsReserved || []
            const alreadyTaken = requestedSeats.filter((s: string) =>
              availability.reservedSeats.includes(s)
            )

            if (alreadyTaken.length > 0) {
              throw new Error(
                `E_SEATS_ALREADY_TAKEN: Les places suivantes sont déjà réservées sur ce trajet : ${alreadyTaken.join(', ')}`
              )
            }
          })
        }
      }
      // ------------------------------------------------------------------

      const resolvedWallets = await this.resolveWalletsForIntent(intent, effectiveTrx)
      const splits = this.buildExternalPaymentSplits(intent, resolvedWallets)

      if (splits.length === 0 && intent.amount > 0) {
        throw new Error('No wallet splits configured')
      }

      const waveIntent = await walletBridge.createPaymentIntent({
        amount: intent.amount,
        externalReference: `${intent.id}`,
        description: `Paiement commande ${intent.orderId}`,
        successUrl,
        errorUrl,
        splits,
      })

      intent.externalId = waveIntent.payment_intent_id
      await intent.useTransaction(effectiveTrx).save()
      if (waveIntent.wave_checkout_url && waveIntent.expires_at) {
        await paymentCheckoutCacheService.set(intent.id, {
          checkoutUrl: waveIntent.wave_checkout_url,
          externalId: waveIntent.payment_intent_id,
          expiresAt: waveIntent.expires_at,
        })
      }

      if (!trx) await effectiveTrx.commit()

      logger.info(
        {
          intentId: intent.id,
          externalId: intent.externalId,
        },
        '[PaymentIntent] Authorized'
      )

      return { checkoutUrl: waveIntent.wave_checkout_url || undefined }
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      await paymentCheckoutCacheService.clear(id)

      // Try to persist terminal states in a SEPARATE transaction if the main one failed
      try {
        const failTrx = await db.transaction()
        const failIntent = await PaymentIntent.find(id, { client: failTrx })
        if (failIntent) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          const failBooking = failIntent.bookingId
            ? await (
              await import('#models/booking')
            ).default.find(failIntent.bookingId, { client: failTrx })
            : null

          if (errorMessage.startsWith('E_BOOKING_HOLD_EXPIRED')) {
            if (failBooking && failBooking.status === 'PENDING') {
              failBooking.status = 'EXPIRED'
              await failBooking.useTransaction(failTrx).save()
            }
            failIntent.status = 'FAILED'
            failIntent.externalId = null
            await failIntent.useTransaction(failTrx).save()
          } else {
            failIntent.status = 'FAILED'
            await failIntent.useTransaction(failTrx).save()
          }
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
    const effectiveTrx = trx || (await db.transaction())

    try {
      const intent = await (PaymentIntent as any)
        .query({ client: effectiveTrx })
        .where('stop_id', stopId)
        .where('status', 'PENDING')
        .preload('order', (q: any) => q.preload('driver'))
        .first()

      if (!intent) {
        // Even if there's no payment intent (e.g. Free order), we might still have a reversal to process.
        // Proceed to check for reversal below.
      } else {
        try {
          const resolvedWallets = await this.resolveWalletsForIntent(intent, effectiveTrx)
          const releaseWalletId = resolvedWallets.companyId
            ? resolvedWallets.companyDriverWalletId
            : resolvedWallets.driverWalletId

          if (intent.driverAmount > 0 && !releaseWalletId) {
            if (resolvedWallets.companyId) {
              throw new Error(`Company-driver wallet not configured for order ${intent.orderId}`)
            }
            throw new Error(`Driver wallet not configured for order ${intent.orderId}`)
          }

          if (releaseWalletId && intent.driverAmount > 0) {
            await walletBridge.releaseFunds({
              wallet_id: releaseWalletId,
              amount: intent.driverAmount,
              label: `Release stop ${stopId}`,
              external_reference: `stop_${stopId}`,
            })
          }

          intent.status = 'COMPLETED'
          await intent.useTransaction(effectiveTrx).save()

          logger.info(
            {
              stopId,
              amount: intent.amount,
            },
            '[PaymentIntent] Stop payment released'
          )
        } catch (error) {
          logger.error(
            { stopId, intentId: intent.id, error: error.message },
            '[PaymentIntent] Failed to release stop payment funds, but keeping intent status to avoid premature FAILURE'
          )
        }
      }

      // --- Reversal Logic (Stop-Based Payout) ---
      // Distinguish between Digital Payments (Wave) and Cash (COD)
      // If the intent is Digital and Completed, the funds are safely in the platform's hands, so we reverse immediately.
      // If it's Cash (COD), we wait for handleCod/settleCod to execute the reversal to avoid cash advance risks.

      const isCod = intent?.paymentMethod === 'CASH' || intent?.paymentMethod === 'COD'

      if (!isCod) {
        const stop = await (await import('#models/stop')).default.find(stopId, { client: effectiveTrx })
        if (stop && stop.reversalAmount > 0) {
          try {
            const order = await (await import('#models/order')).default.query({ client: effectiveTrx }).where('id', stop.orderId).preload('client').first()
            if (order && order.client) {
              const userWalletId = order.client.walletId
              if (userWalletId) {
                const feePercentage = stop.includeWithdrawalFees ? 0.01 : 0
                const feeAmount = Math.ceil(stop.reversalAmount * feePercentage)
                const netAmount = stop.reversalAmount - feeAmount

                if (netAmount > 0) {
                  // We use a peer-to-peer transfer to credit the user from the system wallet
                  // This is safe here because this block only runs for non-COD, meaning funds are guaranteed.
                  await walletBridge.transfer({
                    from_wallet_id: 'SYSTEM_WALLET_ID', // Replace with an actual system wallet variable or admin wallet
                    to_wallet_id: userWalletId,
                    amount: netAmount,
                    label: `Reversement Stop ${stopId}`,
                    external_reference: `reversal_${stopId}`
                  })

                  logger.info({ stopId, netAmount, feeAmount }, '[OrderPaymentService] Processed stop reversal payout (Digital Payment)')
                }
              } else {
                logger.warn({ stopId, clientId: order.clientId }, '[OrderPaymentService] Client has no wallet for reversal payout')
              }
            }
          } catch (reversalError) {
            logger.error({ stopId, error: reversalError.message }, '[OrderPaymentService] Failed to process stop reversal payout')
          }
        }
      }
      // --- End Reversal Logic ---

      if (!trx) await effectiveTrx.commit()

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
  async syncIntentStatus(
    intentId: string,
    status: 'COMPLETED' | 'FAILED',
    trx?: TransactionClientContract
  ): Promise<void> {
    const effectiveTrx = trx || (await db.transaction())
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
      await paymentCheckoutCacheService.clear(intent.id)

      if (status === 'COMPLETED') {
        // Bonus actions specifically for Bookings
        if (intent.bookingId) {
          const voyageService = new VoyageService()
          const booking = await (await import('#models/booking')).default
            .query({ client: effectiveTrx })
            .where('id', intent.bookingId)
            .first()

          if (booking) {
            // FINAL SAFETY CHECK: Redis Lock & Segment Availability
            await RedisLock.runWithLock(`voyage:${booking.orderId}:seats`, async () => {
              const availability = await voyageService.getSeats(
                booking.orderId,
                booking.pickupStopId || undefined,
                booking.dropoffStopId || undefined,
                effectiveTrx,
                { excludeBookingId: booking.id }
              )

              const requestedSeats = booking.seatsReserved || []
              const confirmedConflict = requestedSeats.filter((s: string) =>
                availability.confirmedReservedSeats.includes(s)
              )
              if (confirmedConflict.length > 0) {
                throw new Error(
                  `E_FINAL_SEATS_CONFLICT: Désolé, les places ${confirmedConflict.join(', ')} ont été confirmées par un autre paiement entre-temps.`
                )
              }

              booking.status = 'CONFIRMED'
              await booking.useTransaction(effectiveTrx).save()
              logger.info(
                { bookingId: booking.id, intentId },
                '[PaymentIntent] Booking confirmed after successful payment'
              )

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
    const intents = await (PaymentIntent as any)
      .query({ client: trx })
      .where('order_id', orderId)
      .whereNot('status', 'COMPLETED')

    for (const intent of intents) {
      intent.status = 'COMPLETED'
      if (trx) {
        await intent.useTransaction(trx).save()
      } else {
        await intent.save()
      }
      await paymentCheckoutCacheService.clear(intent.id)
    }

    logger.info(
      { orderId, count: intents.length },
      '[PaymentIntent] Order delivered - payment completed'
    )
  }

  // ── COD ──

  async handleCod(
    id: string,
    user: User,
    data: any,
    trx?: TransactionClientContract
  ): Promise<CodCollection> {
    const validated = await vine.validate({ schema: codSchema, data })
    const effectiveTrx = trx || (await db.transaction())

    try {
      const intent = await (PaymentIntent as any)
        .query({ client: effectiveTrx })
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

      const resolvedWallets = await this.resolveWalletsForIntent(intent, effectiveTrx)
      const settlementBlockingReason = this.getCodSettlementBlockingReason(intent, resolvedWallets)

      if (settlementBlockingReason) {
        settlementMode = 'DEFERRED'
        deferredReason = settlementBlockingReason
        status = 'COD_DEFERRED'
      } else if (resolvedWallets.companyId ? resolvedWallets.companyDriverWalletId : resolvedWallets.driverWalletId) {
        try {
          const settlementWalletId = resolvedWallets.companyId
            ? resolvedWallets.companyDriverWalletId!
            : resolvedWallets.driverWalletId!
          const balance = await walletBridge.getBalance(settlementWalletId)
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

      const codCollection = await CodCollection.create(
        {
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
        },
        { client: effectiveTrx }
      )

      if (settlementMode === 'IMMEDIATE') {
        try {
          await this.settleCodFromDriverWallet(intent, codCollection, resolvedWallets)
          codCollection.status = 'SETTLED'
          codCollection.settledAt = DateTime.now()
          await codCollection.useTransaction(effectiveTrx).save()
        } catch (error) {
          logger.error(
            { error, codId: codCollection.id },
            '[PaymentIntent] Failed to settle COD immediately'
          )
          codCollection.settlementMode = 'DEFERRED'
          codCollection.deferredReason = 'Débit wallet échoué'
          codCollection.status = 'COD_DEFERRED'
          await codCollection.useTransaction(effectiveTrx).save()
        }
      }

      intent.status = codCollection.status === 'SETTLED' ? 'COMPLETED' : 'PENDING'
      await intent.useTransaction(effectiveTrx).save()
      await paymentCheckoutCacheService.clear(intent.id)

      if (!trx) await effectiveTrx.commit()

      if (codCollection.status === 'COD_DEFERRED' || codCollection.status === 'SETTLED') {
        WsService.notifyDebtUpdate(user.id, {
          codId: codCollection.id,
          status: codCollection.status,
          amount: validated.collectedAmount,
        })
      }

      return codCollection
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }

  // ── Refund ──

  async refund(id: string, _user: User, data: any, trx?: TransactionClientContract): Promise<void> {
    const validated = await vine.validate({ schema: refundSchema, data })
    const effectiveTrx = trx || (await db.transaction())

    try {
      const intent = await (PaymentIntent as any)
        .query({ client: effectiveTrx })
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
      await paymentCheckoutCacheService.clear(intent.id)

      if (!trx) await effectiveTrx.commit()

      logger.info({ paymentIntentId: id, amount: intent.amount }, '[PaymentIntent] Refunded')
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }

  // ── Settle deferred COD (batch/cron) ──

  async settlePendingCod(): Promise<{ settled: number; failed: number; total: number }> {
    const deferred = await (CodCollection as any)
      .query()
      .where('status', 'COD_DEFERRED')
      .preload('paymentIntent', (q: any) => q.preload('order', (o: any) => o.preload('driver')))
      .exec()

    let settled = 0
    let failed = 0

    for (const cod of deferred) {
      try {
        const resolvedWallets = await this.resolveWalletsForIntent(cod.paymentIntent)
        const settlementBlockingReason = this.getCodSettlementBlockingReason(
          cod.paymentIntent,
          resolvedWallets
        )

        if (settlementBlockingReason) {
          throw new Error(settlementBlockingReason)
        }

        await this.settleCodFromDriverWallet(cod.paymentIntent, cod, resolvedWallets)
        cod.status = 'SETTLED'
        cod.settledAt = DateTime.now()
        await cod.save()

        cod.paymentIntent.status = 'COMPLETED'
        await cod.paymentIntent.save()

        // Notify driver
        const driverId = cod.paymentIntent.order?.driverId
        if (driverId) {
          WsService.notifyDebtUpdate(driverId, {
            codId: cod.id,
            status: 'SETTLED',
            amount: cod.collectedAmount,
          })
        }

        settled++
      } catch (error) {
        logger.error({ codId: cod.id, error }, '[PaymentIntent] Failed to settle deferred COD')
        failed++
      }
    }

    logger.info(
      { settled, failed, total: deferred.length },
      '[PaymentIntent] Deferred COD settlement batch'
    )
    return { settled, failed, total: deferred.length }
  }

  // ── Private ──

  private async settleCodFromDriverWallet(
    intent: PaymentIntent,
    cod: CodCollection,
    wallets: ResolvedPaymentWallets
  ): Promise<void> {
    const settlementPayerWalletId = wallets.companyId
      ? wallets.companyDriverWalletId
      : wallets.driverWalletId

    if (!settlementPayerWalletId) {
      if (wallets.companyId) {
        throw new Error(`Company-driver wallet not configured for order ${intent.orderId}`)
      }
      throw new Error(`Driver wallet not configured for order ${intent.orderId}`)
    }

    const splits: Array<{
      wallet_id: string
      amount: number
      category: 'COD_SETTLEMENT'
      label: string
    }> = []

    if (intent.platformFee > 0) {
      if (!wallets.platformWalletId) {
        throw new Error('Platform wallet not configured')
      }

      splits.push({
        wallet_id: wallets.platformWalletId,
        amount: intent.platformFee,
        category: 'COD_SETTLEMENT',
        label: `Règlement COD - commission plateforme ${intent.orderId}`,
      })
    }

    if (intent.companyAmount > 0) {
      if (!wallets.companyWalletId) {
        throw new Error(`Company wallet not configured for order ${intent.orderId}`)
      }

      splits.push({
        wallet_id: wallets.companyWalletId,
        amount: intent.companyAmount,
        category: 'COD_SETTLEMENT',
        label: `Règlement COD - commission entreprise ${intent.orderId}`,
      })
    }

    if (splits.length > 0) {
      const totalToTransfer = splits.reduce((s, sp) => s + sp.amount, 0)
      await walletBridge.createInternalTransfer({
        payer_wallet_id: settlementPayerWalletId,
        amount: totalToTransfer,
        description: `Règlement COD commande ${intent.orderId}`,
        external_reference: `cod_${cod.id}`,
        splits,
      })
    }

    // --- COD Reversal Logic ---
    // Now that the driver's wallet has been successfully debited for the COD (or it was confirmed),
    // we can safely execute any pending stop reversals for this specific COD collection context.
    // If the COD was tied to a specific stop, we reverse that stop. 
    // If it's for the whole order, we find all stops with reversals that haven't been processed 
    // (for simplicity now, we iterate over all stops belonging to this order).

    // Ensure we have access to order and stops
    if (!(intent as any).order) {
      await (intent as any).load('order')
    }
    const order = (intent as any).order as Order
    const stopsQuery = await (await import('#models/stop')).default.query()
      .where('orderId', order.id)
      .where('reversalAmount', '>', 0)

    // If cod was for a specific stop, only reverse that one
    const stopsToProcess = cod.stopId
      ? stopsQuery.filter(s => s.id === cod.stopId)
      : stopsQuery

    if (stopsToProcess.length > 0) {
      await order.load('client')
      const userWalletId = order.client?.walletId

      if (userWalletId) {
        for (const stop of stopsToProcess) {
          try {
            const feePercentage = stop.includeWithdrawalFees ? 0.01 : 0
            const feeAmount = Math.ceil(stop.reversalAmount * feePercentage)
            const netAmount = stop.reversalAmount - feeAmount

            if (netAmount > 0) {
              await walletBridge.transfer({
                from_wallet_id: settlementPayerWalletId, // Transfer directly from driver to merchant
                to_wallet_id: userWalletId,
                amount: netAmount,
                label: `Reversement Stop ${stop.id} (COD)`,
                external_reference: `reversal_cod_${stop.id}_${cod.id}`
              })

              logger.info({ stopId: stop.id, codId: cod.id, netAmount }, '[OrderPaymentService] Processed stop reversal payout from COD settlement')
            }
          } catch (reversalError) {
            logger.error({ stopId: stop.id, codId: cod.id, error: reversalError.message }, '[OrderPaymentService] Failed to process stop reversal payout during COD settlement')
          }
        }
      } else {
        logger.warn({ orderId: order.id, codId: cod.id }, '[OrderPaymentService] Client has no wallet for COD reversal payout')
      }
    }
    // --- End COD Reversal Logic ---
  }

  calculateSplits(
    intent: { amount: number; calculatedAmount?: number; bookingId?: string | null },
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
    const dynamicCommandePercent =
      rates?.commandeCommissionPercent ?? DEFAULT_COMMANDE_COMMISSION_PERCENT
    const dynamicTicketPercent = rates?.ticketFeePercent ?? DEFAULT_TICKET_FEE_PERCENT
    const dynamicPercent =
      template === 'COMMANDE'
        ? dynamicCommandePercent
        : template === 'VOYAGE' && intent.bookingId
          ? dynamicTicketPercent
          : 0

    let platformTargetPercent = 0
    if (!policy?.platformCommissionExempt) {
      platformTargetPercent = (policy?.platformCommissionPercent ?? 5) + dynamicPercent
    }
    const companyTargetPercent = policy?.companyCommissionPercent ?? 0

    // 2. Ticket Markup (Specific for VOYAGE Bookings)
    let ticketMarkupAmount = 0
    if (intent.bookingId && policy && policy.ticketMarkupPercent) {
      ticketMarkupAmount = Math.round(
        ((intent.calculatedAmount || totalAmount) * policy.ticketMarkupPercent) / 100
      )
    }

    // 3. Calculer les montants bruts (avant frais Wave)
    const platformGross =
      platformTargetPercent > 0 || policy?.platformCommissionFixed
        ? Math.round(((intent.calculatedAmount || totalAmount) * platformTargetPercent) / 100) +
        (policy?.platformCommissionFixed ?? 0)
        : 0
    const totalPlatformGross = platformGross + ticketMarkupAmount

    const companyGross = companyId
      ? Math.round(((intent.calculatedAmount || totalAmount) * companyTargetPercent) / 100) +
      (policy?.companyCommissionFixed ?? 0)
      : 0

    // 4. Appliquer les frais Wave au prorata sur chaque acteur
    const waveFeeBps = Number.isFinite(Number(rates?.waveFeeBps))
      ? Math.max(0, Math.floor(Number(rates?.waveFeeBps)))
      : this.fallbackWaveFeeBps
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
      waveFee,
    }
  }
}

export default new OrderPaymentService()
