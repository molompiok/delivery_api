import { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import VoyageService from '#services/voyage_service'

@inject()
export default class VoyagesController {
  constructor(protected voyageService: VoyageService) {}

  /**
   * List all published voyages.
   */
  async index({ request, response }: HttpContext) {
    try {
      const companyId = request.input('companyId')
      const voyages = await this.voyageService.listPublished(companyId)
      return response.ok(voyages.map((v) => v.serialize()))
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  /**
   * Get details of a single published voyage.
   */
  async show({ params, response }: HttpContext) {
    try {
      const voyage = await this.voyageService.getPublishedVoyage(params.id)
      return response.ok(voyage.serialize())
    } catch (error: any) {
      return response.notFound({ message: 'Voyage not found' })
    }
  }

  /**
   * Get seat availability for a voyage.
   */
  async seats({ params, request, response }: HttpContext) {
    try {
      const pickupStopId = request.input('pickup_stop_id')
      const dropoffStopId = request.input('dropoff_stop_id')
      const bookingId = request.input('booking_id')

      const seats = await this.voyageService.getSeats(
        params.id,
        pickupStopId,
        dropoffStopId,
        undefined,
        bookingId ? { excludeBookingId: bookingId } : undefined
      )
      return response.ok(seats)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }
}
