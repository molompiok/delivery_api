import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Booking from '#models/booking'
import Order from '#models/order'
import TransitItem from '#models/transit_item'
import Action from '#models/action'
import PaymentIntent from '#models/payment_intent'
import OrderPaymentService from '#services/order_payment_service'
import PricingFilterService from '#services/pricing_filter_service'
import PaymentPolicyService from '#services/payment_policy_service'
import VoyageService from '#services/voyage_service'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import vine from '@vinejs/vine'

const createBookingSchema = vine.object({
  seats: vine.array(vine.string()).minLength(1),
  pickupStopId: vine.string(),
  dropoffStopId: vine.string(),
  replaceBookingId: vine.string().trim().optional(),
  luggage: vine
    .array(
      vine.object({
        description: vine.string().trim().optional(),
        weight: vine.number().positive().optional(),
      })
    )
    .optional(),
})

export default class BookingService {
  private static readonly pendingHoldMinutes = 5

  constructor(protected voyageService: VoyageService = new VoyageService()) {}

  private getPendingHoldAnchor(booking: Booking) {
    return booking.updatedAt || booking.createdAt
  }

  private isPendingHoldExpired(booking: Booking) {
    if (booking.status !== 'PENDING') {
      return false
    }

    const anchor = this.getPendingHoldAnchor(booking)
    if (!anchor) {
      return false
    }

    return (
      anchor.plus({ minutes: BookingService.pendingHoldMinutes }).toMillis() <=
      DateTime.now().toMillis()
    )
  }

  private async markBookingExpired(booking: Booking, trx?: TransactionClientContract) {
    if (booking.status !== 'PENDING' || !this.isPendingHoldExpired(booking)) {
      return false
    }

    booking.status = 'EXPIRED'
    if (trx) {
      await booking.useTransaction(trx).save()
    } else {
      await booking.save()
    }

    await PaymentIntent.query({ client: trx })
      .where('bookingId', booking.id)
      .where('status', 'PENDING')
      .update({ status: 'FAILED' })

    return true
  }

  private async syncClientPendingBookings(bookings: Booking[], trx?: TransactionClientContract) {
    let changed = false

    for (const booking of bookings) {
      const expired = await this.markBookingExpired(booking, trx)
      changed = changed || expired
    }

    return changed
  }

  private async setBookingPaymentIntentPending(bookingId: string, trx?: TransactionClientContract) {
    const latestIntent = await PaymentIntent.query({ client: trx })
      .where('bookingId', bookingId)
      .orderBy('created_at', 'desc')
      .first()

    if (!latestIntent) {
      return
    }

    latestIntent.status = 'PENDING'
    latestIntent.externalId = null
    if (trx) {
      await latestIntent.useTransaction(trx).save()
    } else {
      await latestIntent.save()
    }
  }

  private async failBookingPaymentIntents(bookingId: string, trx?: TransactionClientContract) {
    await PaymentIntent.query({ client: trx })
      .where('bookingId', bookingId)
      .where('status', 'PENDING')
      .update({ status: 'FAILED' })
  }

  private calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371 // km
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  private resolveSeatPrice(seatMap: any, seat: string, basePrice: number) {
    let amount = basePrice
    let isVip = false

    if (seatMap && seatMap[seat]) {
      if (seatMap[seat] === 'VIP' || seatMap[seat] === 'vip') {
        amount += 2000
        isVip = true
      } else if (typeof seatMap[seat] === 'object' && seatMap[seat].rule) {
        isVip = seatMap[seat].isVip === true
        const rule = seatMap[seat].rule
        if (rule.type === 'addition') {
          amount += rule.value
        } else if (rule.type === 'multiplier') {
          amount = Math.round(amount * rule.value)
        }
      }
    }

    return { amount, isVip }
  }

  private async normalizeLuggageItem(
    item: any,
    index: number,
    ctx: {
      order: Order
      trx?: TransactionClientContract
      distanceKm: number
      ticketMarkupPercent: number
    }
  ) {
    const description = String(item?.description || '').trim() || `Bagage ${index + 1}`
    const weight = Number(item?.weight)
    const normalizedWeight = Number.isFinite(weight) && weight > 0 ? weight : 10
    const fallbackAmount = Math.round(normalizedWeight * 100)
    let amount = fallbackAmount

    try {
      const filter = await PricingFilterService.resolve(
        ctx.order.driverId,
        ctx.order.companyId,
        'VOYAGE',
        ctx.trx
      )

      if (filter) {
        const breakdown = PricingFilterService.calculateStopPrice(filter, {
          distanceKm: ctx.distanceKm,
          weightKg: normalizedWeight,
          volumeM3: 0,
          template: 'VOYAGE',
        })

        amount = breakdown.finalAmount
      }
    } catch (_) {}

    if (ctx.ticketMarkupPercent > 0) {
      amount = Math.round(amount * (1 + ctx.ticketMarkupPercent / 100))
    }

    return {
      description,
      weight: normalizedWeight,
      amount,
      pricingMode: amount == fallbackAmount ? 'fallback' : 'company',
    }
  }

  private async buildBookingEstimate(orderId: string, data: any, trx?: TransactionClientContract) {
    const validatedData = await vine.validate({ schema: createBookingSchema, data })
    let replaceBooking: Booking | null = null

    if (validatedData.replaceBookingId) {
      replaceBooking = await Booking.query({ client: trx })
        .where('id', validatedData.replaceBookingId)
        .where('orderId', orderId)
        .firstOrFail()
    }

    const order = await Order.query({ client: trx })
      .where('id', orderId)
      .preload('stops', (q) =>
        q.orderBy('execution_order', 'asc').orderBy('display_order', 'asc').preload('address')
      )
      .firstOrFail()

    if (order.template !== 'VOYAGE' || order.status !== 'PUBLISHED') {
      throw new Error('This order is not a published voyage and cannot be booked.')
    }

    const availability = await this.voyageService.getSeats(
      orderId,
      validatedData.pickupStopId,
      validatedData.dropoffStopId,
      trx,
      replaceBooking ? { excludeBookingId: replaceBooking.id } : undefined
    )
    const requestedSeats = validatedData.seats || []

    if (requestedSeats.length === 0) {
      throw new Error('At least one seat must be selected.')
    }

    const alreadyReserved = requestedSeats.some((seat) => availability.reservedSeats.includes(seat))
    if (alreadyReserved) {
      throw new Error('One or more selected seats are already reserved.')
    }

    if (availability.availableCount < requestedSeats.length) {
      throw new Error('Not enough seats available.')
    }

    const pickupIndex = order.stops.findIndex((stop) => stop.id === validatedData.pickupStopId)
    const dropoffIndex = order.stops.findIndex((stop) => stop.id === validatedData.dropoffStopId)

    if (pickupIndex === -1 || dropoffIndex === -1 || pickupIndex >= dropoffIndex) {
      throw new Error('Pickup stop must precede dropoff stop')
    }

    let distanceKm = 0
    for (let i = pickupIndex; i < dropoffIndex; i++) {
      const stop1 = order.stops[i]
      const stop2 = order.stops[i + 1]
      if (stop1.address && stop2.address) {
        distanceKm += this.calculateHaversineDistance(
          stop1.address.lat,
          stop1.address.lng,
          stop2.address.lat,
          stop2.address.lng
        )
      }
    }

    if (distanceKm <= 0) {
      distanceKm = 1
    }

    let ticketPrice = 500
    let isMatrixPrice = false
    let ticketMarkupPercent = 0
    const pData = order.pricingData as import('../types/logistics.js').PricingDetails

    if (
      pData?.matrix &&
      pData.matrix[validatedData.pickupStopId] &&
      pData.matrix[validatedData.pickupStopId][validatedData.dropoffStopId] !== undefined
    ) {
      ticketPrice = pData.matrix[validatedData.pickupStopId][validatedData.dropoffStopId]
      isMatrixPrice = true
    }

    if (!isMatrixPrice) {
      try {
        const filter = await PricingFilterService.resolve(
          order.driverId,
          order.companyId,
          'VOYAGE',
          trx
        )
        if (filter) {
          const breakdown = PricingFilterService.calculateStopPrice(filter, {
            distanceKm,
            weightKg: 0,
            volumeM3: 0,
          })
          ticketPrice = breakdown.finalAmount
        }
      } catch (_) {
        if (pData?.clientFee) ticketPrice = pData.clientFee
      }
    }

    try {
      const policy = await PaymentPolicyService.resolve(
        order.driverId,
        order.companyId,
        'VOYAGE',
        trx
      )
      if (policy && policy.ticketMarkupPercent > 0) {
        ticketMarkupPercent = policy.ticketMarkupPercent
        ticketPrice = Math.round(ticketPrice * (1 + policy.ticketMarkupPercent / 100))
      }
    } catch (_) {}

    const seatMap = order.metadata?.seatMap as any
    const seatQuotes = requestedSeats.map((seat) => {
      const quote = this.resolveSeatPrice(seatMap, seat, ticketPrice)
      return {
        seat,
        amount: quote.amount,
        isVip: quote.isVip,
      }
    })

    const luggageQuotes = await Promise.all(
      ((validatedData as any).luggage || []).map((item: any, index: number) =>
        this.normalizeLuggageItem(item, index, {
          order,
          trx,
          distanceKm,
          ticketMarkupPercent,
        })
      )
    )

    const seatsAmount = seatQuotes.reduce(
      (sum: number, item: { amount: number }) => sum + item.amount,
      0
    )
    const luggageAmount = luggageQuotes.reduce(
      (sum: number, item: { amount: number }) => sum + item.amount,
      0
    )
    const pickupStop = order.stops[pickupIndex]
    const dropoffStop = order.stops[dropoffIndex]

    return {
      order,
      validatedData,
      replaceBooking,
      distanceKm,
      ticketPrice,
      seatQuotes,
      luggageQuotes,
      totals: {
        seatsAmount,
        luggageAmount,
        totalAmount: seatsAmount + luggageAmount,
      },
      segment: {
        pickupStopId: validatedData.pickupStopId,
        dropoffStopId: validatedData.dropoffStopId,
        pickupLabel: pickupStop?.address?.street || 'Depart',
        dropoffLabel: dropoffStop?.address?.street || 'Arrivee',
      },
    }
  }

  async estimateBooking(orderId: string, data: any, trx?: TransactionClientContract) {
    const quote = await this.buildBookingEstimate(orderId, data, trx)

    return {
      voyageId: orderId,
      segment: quote.segment,
      distanceKm: Number(quote.distanceKm.toFixed(1)),
      seatCount: quote.seatQuotes.length,
      luggageCount: quote.luggageQuotes.length,
      seatQuotes: quote.seatQuotes,
      luggageQuotes: quote.luggageQuotes,
      baseSeatPrice: quote.ticketPrice,
      totals: quote.totals,
    }
  }

  /**
   * Creates a new booking for a voyage.
   */
  async createBooking(
    orderId: string,
    clientId: string,
    data: any,
    trx?: TransactionClientContract
  ) {
    const effectiveTrx = trx || (await db.transaction())

    try {
      const quote = await this.buildBookingEstimate(orderId, data, effectiveTrx)
      const order = quote.order
      const validatedData = quote.validatedData
      const requestedSeats = validatedData.seats || []
      const replaceBooking = quote.replaceBooking

      if (replaceBooking) {
        if (replaceBooking.clientId !== clientId) {
          throw new Error('This booking cannot be replaced by the current client.')
        }

        replaceBooking.status = 'CANCELLED'
        await replaceBooking.useTransaction(effectiveTrx).save()
        await this.failBookingPaymentIntents(replaceBooking.id, effectiveTrx)
      }

      // 1. Create Booking
      const booking = await Booking.create(
        {
          orderId,
          clientId,
          seatsReserved: requestedSeats,
          pickupStopId: validatedData.pickupStopId,
          dropoffStopId: validatedData.dropoffStopId,
          status: 'PENDING',
        },
        { client: effectiveTrx }
      )

      // 2. Create TransitItems and Actions (one per passenger/seat)
      for (const seatQuote of quote.seatQuotes) {
        const transitItem = await TransitItem.create(
          {
            orderId,
            bookingId: booking.id,
            name: `Billet - Place ${seatQuote.seat}`,
            packagingType: 'person',
            weight: 0,
            unitaryPrice: seatQuote.amount,
            metadata: { seat: seatQuote.seat, isVip: seatQuote.isVip },
            isPendingChange: false,
          },
          { client: effectiveTrx }
        )

        // 3. Create Actions
        // PICKUP Action
        await Action.create(
          {
            orderId,
            stopId: validatedData.pickupStopId,
            transitItemId: transitItem.id,
            type: 'PICKUP',
            quantity: 1,
            status: 'PENDING',
            serviceTime: 60, // 1 min per passenger
            metadata: { ticketType: 'VOYAGE', seat: seatQuote.seat },
            isPendingChange: false,
            isDeleteRequired: false,
          },
          { client: effectiveTrx }
        )

        // DELIVERY Action
        await Action.create(
          {
            orderId,
            stopId: validatedData.dropoffStopId,
            transitItemId: transitItem.id,
            type: 'DELIVERY',
            quantity: 1,
            status: 'PENDING',
            serviceTime: 60, // 1 min per passenger
            metadata: { ticketType: 'VOYAGE', seat: seatQuote.seat },
            isPendingChange: false,
            isDeleteRequired: false,
          },
          { client: effectiveTrx }
        )
      }

      // 2.5 Generate Luggage TransitItems if requested
      for (const lug of quote.luggageQuotes) {
        const transitItem = await TransitItem.create(
          {
            orderId,
            bookingId: booking.id,
            name: `Bagage Soute - ${lug.description}`,
            packagingType: 'box',
            weight: lug.weight,
            unitaryPrice: lug.amount,
            metadata: { type: 'luggage' },
            isPendingChange: false,
          },
          { client: effectiveTrx }
        )

        await Action.create(
          {
            orderId,
            stopId: validatedData.pickupStopId,
            transitItemId: transitItem.id,
            type: 'PICKUP',
            quantity: 1,
            status: 'PENDING',
            serviceTime: 120,
            metadata: { itemType: 'LUGGAGE' },
            isPendingChange: false,
            isDeleteRequired: false,
          },
          { client: effectiveTrx }
        )

        await Action.create(
          {
            orderId,
            stopId: validatedData.dropoffStopId,
            transitItemId: transitItem.id,
            type: 'DELIVERY',
            quantity: 1,
            status: 'PENDING',
            serviceTime: 120,
            metadata: { itemType: 'LUGGAGE' },
            isPendingChange: false,
            isDeleteRequired: false,
          },
          { client: effectiveTrx }
        )
      }

      // 3. Generate Payment Intents
      await OrderPaymentService.generateIntentsForOrder(order, effectiveTrx)

      if (!trx) await effectiveTrx.commit()

      return booking
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()
      throw error
    }
  }

  /**
   * Lists all bookings for a specific client, preloaded with voyage details.
   */
  async listClientBookings(clientId: string) {
    const bookings = await Booking.query()
      .where('clientId', clientId)
      .preload('transitItems')
      .preload('pickupStop', (q: any) => q.preload('address'))
      .preload('dropoffStop', (q: any) => q.preload('address'))
      .orderBy('createdAt', 'desc')

    await this.syncClientPendingBookings(bookings)
    return bookings
  }

  async getClientBooking(clientId: string, bookingId: string) {
    const booking = await Booking.query()
      .where('id', bookingId)
      .where('clientId', clientId)
      .preload('transitItems')
      .preload('pickupStop', (q: any) => q.preload('address'))
      .preload('dropoffStop', (q: any) => q.preload('address'))
      .firstOrFail()

    await this.syncClientPendingBookings([booking])
    return booking
  }

  async reactivateClientBooking(
    clientId: string,
    bookingId: string,
    trx?: TransactionClientContract
  ) {
    const effectiveTrx = trx || (await db.transaction())

    try {
      const booking = await (Booking as any)
        .query({ client: effectiveTrx })
        .where('id', bookingId)
        .where('clientId', clientId)
        .preload('order', (q: any) =>
          q.preload('stops', (sq: any) =>
            sq.orderBy('execution_order', 'asc').orderBy('display_order', 'asc').preload('address')
          )
        )
        .preload('transitItems')
        .preload('pickupStop', (q: any) => q.preload('address'))
        .preload('dropoffStop', (q: any) => q.preload('address'))
        .forUpdate()
        .firstOrFail()

      await this.syncClientPendingBookings([booking], effectiveTrx)

      if (booking.status === 'CONFIRMED') {
        throw new Error('Ce billet est deja confirme.')
      }

      if (booking.order.template !== 'VOYAGE' || booking.order.status !== 'PUBLISHED') {
        throw new Error(
          "E_BOOKING_REBOOK_REQUIRED: Ce voyage n'est plus ouvert. Merci de recommander un billet."
        )
      }

      const currentSeats = booking.seatsReserved || []
      if (currentSeats.length == 0 || !booking.pickupStopId || !booking.dropoffStopId) {
        throw new Error(
          'E_BOOKING_REBOOK_REQUIRED: Ce billet ne peut plus etre reactive. Merci de recommander un billet.'
        )
      }

      const availability = await this.voyageService.getSeats(
        booking.orderId,
        booking.pickupStopId,
        booking.dropoffStopId,
        effectiveTrx,
        { excludeBookingId: booking.id }
      )

      const unavailableSeats = currentSeats.filter((seat: string) =>
        availability.reservedSeats.includes(seat)
      )

      if (unavailableSeats.length > 0) {
        throw new Error(
          `E_BOOKING_REBOOK_REQUIRED: Les places ${unavailableSeats.join(', ')} ne sont plus disponibles. Merci de recommander un billet.`
        )
      }

      booking.status = 'PENDING'
      await booking.useTransaction(effectiveTrx).save()
      await this.setBookingPaymentIntentPending(booking.id, effectiveTrx)

      if (!trx) await effectiveTrx.commit()
      return booking
    } catch (error) {
      if (!trx) await effectiveTrx.rollback()

      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('E_BOOKING_REBOOK_REQUIRED')) {
        const failTrx = await db.transaction()
        try {
          const failBooking = await Booking.query({ client: failTrx })
            .where('id', bookingId)
            .where('clientId', clientId)
            .first()

          if (failBooking && failBooking.status != 'CONFIRMED') {
            failBooking.status = 'CANCELLED'
            await failBooking.useTransaction(failTrx).save()
            await this.failBookingPaymentIntents(failBooking.id, failTrx)
          }

          await failTrx.commit()
        } catch (persistError) {
          await failTrx.rollback()
          throw persistError
        }
      }
      throw error
    }
  }
}
