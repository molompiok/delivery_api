import type { HttpContext } from '@adonisjs/core/http'
import AddressService from '#services/address_service'
import { inject } from '@adonisjs/core'
import vine from '@vinejs/vine'

@inject()
export default class AddressController {
    constructor(protected addressService: AddressService) { }

    static addressValidator = vine.compile(
        vine.object({
            ownerType: vine.enum(['User', 'Company', 'Order', 'Mission', 'Vehicle']),
            ownerId: vine.string(),
            label: vine.string().optional(),
            isDefault: vine.boolean().optional(),
            isActive: vine.boolean().optional(),
            lat: vine.number(),
            lng: vine.number(),
            formattedAddress: vine.string(),
            street: vine.string().optional(),
            city: vine.string().optional(),
            zipCode: vine.string().optional(),
            country: vine.string().optional(),
            details: vine.string().optional(),
        })
    )

    async index({ request, response, auth }: HttpContext) {
        try {
            const { ownerType, ownerId } = request.qs()
            const user = auth.user!
            if (!ownerType || !ownerId) return response.badRequest({ message: 'ownerType and ownerId are required' })

            const addresses = await this.addressService.listAddresses(user, ownerType, ownerId)
            return response.ok(addresses)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async store({ request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const data = await request.validateUsing(AddressController.addressValidator)
            const address = await this.addressService.saveAddress(user, data)
            return response.created(address)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async update({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const data = await request.validateUsing(AddressController.addressValidator)
            const address = await this.addressService.saveAddress(user, { ...data, id: params.id })
            return response.ok(address)
        } catch (error: any) {
            if (error.code === 'E_ROW_NOT_FOUND' || error.message.includes('not found')) {
                return response.notFound({ message: 'Address not found' })
            }
            return response.badRequest({ message: error.message })
        }
    }

    async destroy({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            await this.addressService.deleteAddress(user, params.id)
            return response.noContent()
        } catch (error: any) {
            if (error.code === 'E_ROW_NOT_FOUND' || error.message.includes('not found')) {
                return response.notFound({ message: 'Address not found' })
            }
            return response.badRequest({ message: error.message })
        }
    }

    async setDefault({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const address = await this.addressService.setDefault(user, params.id)
            return response.ok({ message: 'Default address updated', address })
        } catch (error: any) {
            if (error.code === 'E_ROW_NOT_FOUND' || error.message.includes('not found')) {
                return response.notFound({ message: 'Address not found' })
            }
            return response.badRequest({ message: error.message })
        }
    }
}
