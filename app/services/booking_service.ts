import db from '@adonisjs/lucid/services/db'
import Booking from '#models/booking'
import Order from '#models/order'
import TransitItem from '#models/transit_item'
import Action from '#models/action'
import OrderPaymentService from '#services/order_payment_service'
import PricingFilterService from '#services/pricing_filter_service'
import PaymentPolicyService from '#services/payment_policy_service'
import VoyageService from '#services/voyage_service'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import vine from '@vinejs/vine'

const createBookingSchema = vine.object({
    seats: vine.array(vine.string()).minLength(1),
    pickupStopId: vine.string(),
    dropoffStopId: vine.string()
})

export default class BookingService {
    constructor(protected voyageService: VoyageService = new VoyageService()) { }

    private calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Creates a new booking for a voyage.
     */
    async createBooking(orderId: string, clientId: string, data: any, trx?: TransactionClientContract) {
        const validatedData = await vine.validate({ schema: createBookingSchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            const order = await Order.query({ client: effectiveTrx })
                .where('id', orderId)
                .preload('stops', (q) => q.orderBy('execution_order', 'asc').orderBy('display_order', 'asc').preload('address'))
                .firstOrFail()

            if (order.template !== 'VOYAGE' || order.status !== 'PUBLISHED') {
                throw new Error('This order is not a published voyage and cannot be booked.')
            }

            // Check seat availability
            const availability = await this.voyageService.getSeats(orderId, validatedData.pickupStopId, validatedData.dropoffStopId, effectiveTrx)
            const requestedSeats = validatedData.seats || []

            if (requestedSeats.length === 0) {
                throw new Error('At least one seat must be selected.')
            }

            const alreadyReserved = requestedSeats.some(s => availability.reservedSeats.includes(s))
            if (alreadyReserved) {
                throw new Error('One or more selected seats are already reserved.')
            }

            if (availability.availableCount < requestedSeats.length) {
                throw new Error('Not enough seats available.')
            }

            // Calculate segment distance and ticket price
            const pickupIndex = order.stops.findIndex(s => s.id === validatedData.pickupStopId)
            const dropoffIndex = order.stops.findIndex(s => s.id === validatedData.dropoffStopId)
            let distanceKm = 0

            if (pickupIndex !== -1 && dropoffIndex !== -1 && pickupIndex < dropoffIndex) {
                for (let i = pickupIndex; i < dropoffIndex; i++) {
                    const stop1 = order.stops[i]
                    const stop2 = order.stops[i + 1]
                    if (stop1.address && stop2.address) {
                        distanceKm += this.calculateHaversineDistance(stop1.address.lat, stop1.address.lng, stop2.address.lat, stop2.address.lng)
                    }
                }
            } else {
                distanceKm = 1 // Fallback safe distance
            }

            // Initialize ticket price
            let ticketPrice = 500 // Fallback price
            let isMatrixPrice = false

            // 1. Check if manager defined a matrix price for this segment
            const pData = order.pricingData as import('../types/logistics.js').PricingDetails
            if (pData?.matrix && pData.matrix[validatedData.pickupStopId] && pData.matrix[validatedData.pickupStopId][validatedData.dropoffStopId] !== undefined) {
                ticketPrice = pData.matrix[validatedData.pickupStopId][validatedData.dropoffStopId]
                isMatrixPrice = true
            }

            // 2. Fallback to automatic PricingFilterService if no matrix price
            if (!isMatrixPrice) {
                try {
                    const filter = await PricingFilterService.resolve(order.driverId, order.companyId, 'VOYAGE', effectiveTrx)
                    if (filter) {
                        const breakdown = PricingFilterService.calculateStopPrice(filter, {
                            distanceKm,
                            weightKg: 0, // Passengers
                            volumeM3: 0
                        })
                        ticketPrice = breakdown.finalAmount
                    }
                } catch (pricingError) {
                    // If resolving filter fails, try falling back to pricingData
                    if (pData?.clientFee) ticketPrice = pData.clientFee
                }
            }

            // 3. Apply general Ticket Markup (from PaymentPolicy)
            try {
                const policy = await PaymentPolicyService.resolve(order.driverId, order.companyId, 'VOYAGE', effectiveTrx)
                if (policy && policy.ticketMarkupPercent > 0) {
                    // Apply percentage markup
                    ticketPrice = Math.round(ticketPrice * (1 + (policy.ticketMarkupPercent / 100)))
                }
            } catch (policyError) {
                // Silently fallback if policy is unresolvable or fails
            }

            // 1. Create Booking
            const booking = await Booking.create({
                orderId,
                clientId,
                seatsReserved: requestedSeats,
                pickupStopId: validatedData.pickupStopId,
                dropoffStopId: validatedData.dropoffStopId,
                status: 'PENDING'
            }, { client: effectiveTrx })

            // 2. Create TransitItems and Actions (one per passenger/seat)
            for (const seat of requestedSeats) {
                let finalPriceForSeat = ticketPrice

                // VIP Surcharge verification via seatMap
                const seatMap = order.metadata?.seatMap as any
                let isVipFlag = false
                if (seatMap && seatMap[seat]) {
                    if (seatMap[seat] === 'VIP' || seatMap[seat] === 'vip') {
                        finalPriceForSeat += 2000
                        isVipFlag = true
                    } else if (typeof seatMap[seat] === 'object' && seatMap[seat].rule) {
                        isVipFlag = seatMap[seat].isVip === true
                        const rule = seatMap[seat].rule
                        if (rule.type === 'addition') {
                            finalPriceForSeat += rule.value
                        } else if (rule.type === 'multiplier') {
                            finalPriceForSeat = Math.round(finalPriceForSeat * rule.value)
                        }
                    }
                }

                const transitItem = await TransitItem.create({
                    orderId,
                    bookingId: booking.id,
                    name: `Billet - Place ${seat}`,
                    packagingType: 'person',
                    weight: 0,
                    unitaryPrice: finalPriceForSeat,
                    metadata: { seat, isVip: isVipFlag },
                    isPendingChange: false
                }, { client: effectiveTrx })

                // 3. Create Actions
                // PICKUP Action
                await Action.create({
                    orderId,
                    stopId: validatedData.pickupStopId,
                    transitItemId: transitItem.id,
                    type: 'PICKUP',
                    quantity: 1,
                    status: 'PENDING',
                    serviceTime: 60, // 1 min per passenger
                    metadata: { ticketType: 'VOYAGE', seat },
                    isPendingChange: false,
                    isDeleteRequired: false,
                }, { client: effectiveTrx })

                // DELIVERY Action
                await Action.create({
                    orderId,
                    stopId: validatedData.dropoffStopId,
                    transitItemId: transitItem.id,
                    type: 'DELIVERY',
                    quantity: 1,
                    status: 'PENDING',
                    serviceTime: 60, // 1 min per passenger
                    metadata: { ticketType: 'VOYAGE', seat },
                    isPendingChange: false,
                    isDeleteRequired: false,
                }, { client: effectiveTrx })
            }

            // 2.5 Generate Luggage TransitItems if requested
            const luggageList: any[] = (validatedData as any).luggage || []
            for (const lug of luggageList) {
                // Determine price based on weight (e.g. 100 FCFA per kg)
                const price = (lug.weight || 10) * 100
                const transitItem = await TransitItem.create({
                    orderId,
                    bookingId: booking.id,
                    name: `Bagage Soute - ${lug.description || 'Standard'}`,
                    packagingType: 'box',
                    weight: lug.weight || 10,
                    unitaryPrice: price,
                    metadata: { type: 'luggage' },
                    isPendingChange: false
                }, { client: effectiveTrx })

                await Action.create({
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
                }, { client: effectiveTrx })

                await Action.create({
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
                }, { client: effectiveTrx })
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
}
