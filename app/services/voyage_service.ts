import Order from '#models/order'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'

export default class VoyageService {
    /**
     * Lists all published voyages.
     */
    async listPublished(companyId?: string, trx?: TransactionClientContract) {
        const query = Order.query({ client: trx })
            .where('template', 'VOYAGE')
            .where('status', 'PUBLISHED')

        if (companyId) {
            query.where('companyId', companyId)
        }

        return query
            .preload('steps', (q) => q.orderBy('sequence', 'asc')
                .preload('stops', (sq) => sq.orderBy('execution_order', 'asc').orderBy('display_order', 'asc')
                    .preload('address')
                )
            )
            .orderBy('created_at', 'desc')
    }

    /**
     * Gets a single published voyage by ID.
     */
    async getPublishedVoyage(id: string, trx?: TransactionClientContract) {
        return Order.query({ client: trx })
            .where('id', id)
            .where('template', 'VOYAGE')
            .where('status', 'PUBLISHED')
            .preload('steps', (q) => q.orderBy('sequence', 'asc')
                .preload('stops', (sq) => sq.orderBy('execution_order', 'asc').orderBy('display_order', 'asc')
                    .preload('address')
                )
            )
            .preload('vehicle')
            .firstOrFail()
    }

    /**
     * Calculates seat availability for a voyage, optionally for a specific segment.
     */
    async getSeats(orderId: string, pickupStopId?: string, dropoffStopId?: string, trx?: TransactionClientContract) {
        const order = await Order.query({ client: trx })
            .where('id', orderId)
            .preload('vehicle')
            .preload('stops', (q) => q.orderBy('execution_order', 'asc').orderBy('display_order', 'asc'))
            .preload('bookings', (q) => q.whereIn('status', ['CONFIRMED', 'PENDING']))
            .firstOrFail()

        let totalCapacity = 0
        if (order.metadata?.seatMap) {
            totalCapacity = Object.keys(order.metadata.seatMap).length
        } else if (order.vehicle?.metadata?.seatDisposition) {
            totalCapacity = order.vehicle.metadata.seatDisposition.length
        } else if (order.vehicle?.capacity) {
            totalCapacity = order.vehicle.capacity
        }

        let requestedStartIndex = -1
        let requestedEndIndex = Infinity

        if (pickupStopId && dropoffStopId) {
            const pickupIndex = order.stops.findIndex(s => s.id === pickupStopId)
            const dropoffIndex = order.stops.findIndex(s => s.id === dropoffStopId)

            if (pickupIndex === -1 || dropoffIndex === -1) {
                throw new Error('Pickup or dropoff stop not found in this voyage')
            }
            if (pickupIndex >= dropoffIndex) {
                throw new Error('Pickup stop must precede dropoff stop')
            }

            requestedStartIndex = pickupIndex
            requestedEndIndex = dropoffIndex
        } else if (pickupStopId || dropoffStopId) {
            throw new Error('Both pickupStopId and dropoffStopId must be provided together')
        }

        const overlappingBookings = order.bookings.filter(booking => {
            if (!booking.pickupStopId || !booking.dropoffStopId) {
                // Booking without specific stops occupies the whole voyage
                return true
            }

            const bPickupIndex = order.stops.findIndex(s => s.id === booking.pickupStopId)
            const bDropoffIndex = order.stops.findIndex(s => s.id === booking.dropoffStopId)

            // If we can't find the stops, assume it occupies space to be safe
            if (bPickupIndex === -1 || bDropoffIndex === -1) return true

            // Overlap condition:
            // Booking Start is strictly before Requested End AND
            // Booking End is strictly after Requested Start
            return (bPickupIndex < requestedEndIndex) && (bDropoffIndex > requestedStartIndex)
        })

        const reservedSeatsArray = overlappingBookings.flatMap(b => b.seatsReserved || [])
        const reservedSeats = Array.from(new Set(reservedSeatsArray))
        const reservedCount = reservedSeats.length

        // Generate seats list
        const seatMap = order.metadata?.seatMap || {}
        let seats: any[] = []

        if (Object.keys(seatMap).length > 0) {
            seats = Object.entries(seatMap).map(([id, meta]: [string, any]) => ({
                id,
                number: meta.number || id.replace('seat_', ''),
                ...meta,
            }))
        } else if (order.vehicle?.metadata?.seatDisposition) {
            seats = order.vehicle.metadata.seatDisposition
        } else {
            seats = Array.from({ length: totalCapacity }, (_, i) => ({
                id: `seat_${i + 1}`,
                number: `${i + 1}`,
            }))
        }

        return {
            totalCapacity,
            reservedCount,
            availableCount: Math.max(0, totalCapacity - reservedCount),
            reservedSeats,
            seats,
        }
    }
}
