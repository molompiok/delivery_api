import { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import BookingService from '#services/booking_service'

@inject()
export default class BookingsController {
    constructor(protected bookingService: BookingService) { }

    /**
     * Create a booking for a voyage.
     */
    async store({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const payload = request.all()
            const booking = await this.bookingService.createBooking(params.id, user.id, payload)

            return response.created({
                message: 'Booking created successfully',
                booking: booking.serialize()
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List bookings for the authenticated client.
     */
    async index({ response, auth }: HttpContext) {
        try {
            const user = auth.getUserOrFail()
            const bookings = await this.bookingService.listClientBookings(user.id)

            return response.ok({
                data: bookings.map(b => b.serialize())
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
