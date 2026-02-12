import type { HttpContext } from '@adonisjs/core/http'
import GeoService from '#services/geo_service'

export default class GeoController {
    /**
     * Reverse geocode coordinates to address details.
     */
    async reverseGeocode({ request, response }: HttpContext) {
        try {
            const { lat, lng } = request.qs()

            if (!lat || !lng) {
                return response.badRequest({ message: 'Latitude and Longitude are required' })
            }

            const address = await GeoService.reverseGeocode(Number(lat), Number(lng))

            if (!address) {
                return response.notFound({ message: 'Address not found for these coordinates' })
            }

            return response.ok(address)
        } catch (error: any) {
            return response.internalServerError({ message: error.message })
        }
    }
}
