import type { HttpContext } from '@adonisjs/core/http'
import AddressService from '#services/address_service'
import Address from '#models/address'
import User from '#models/user'
import vine from '@vinejs/vine'

export default class AddressController {
    /**
     * Validator for address creation/update
     */
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

    private async canEditAddress(user: User, ownerType: string, ownerId: string): Promise<boolean> {
        if (user.isAdmin) return true;

        // 1. My own address
        if (ownerType === 'User' && ownerId === user.id) return true;

        // 2. Company address
        if (ownerType === 'Company') {
            if (user.companyId === ownerId && user.currentCompanyManaged) return true;
        }

        return false;
    }

    /**
     * List addresses for an owner
     */
    async index({ request, response, auth }: HttpContext) {
        const { ownerType, ownerId } = request.qs()
        const user = auth.user!

        if (!ownerType || !ownerId) {
            return response.badRequest({ message: 'ownerType and ownerId are required' })
        }

        // Security check for LISTING
        if (!(await this.canEditAddress(user, ownerType, ownerId))) {
            // Exception: Listing Company addresses might be public if they are Pickup Points?
            // For now, restrict to Owner/Manager.
            return response.forbidden({ message: 'Permission denied' })
        }

        const addresses = await Address.query()
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .where('isActive', true)
            .orderBy('isDefault', 'desc')
            .orderBy('createdAt', 'desc')

        return response.ok(addresses)
    }

    /**
     * Create a new address
     */
    async store({ request, response, auth }: HttpContext) {
        const data = await request.validateUsing(AddressController.addressValidator)
        const user = auth.user!

        // Security check
        if (!(await this.canEditAddress(user, data.ownerType, data.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        const address = await AddressService.saveAddress(data as any)
        return response.created(address)
    }

    /**
     * Update an address
     */
    async update({ params, request, response, auth }: HttpContext) {
        const address = await Address.find(params.id)
        if (!address) {
            return response.notFound({ message: 'Address not found' })
        }

        const user = auth.user!
        if (!(await this.canEditAddress(user, address.ownerType, address.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        const data = await request.validateUsing(AddressController.addressValidator)

        const updated = await AddressService.saveAddress({ ...data, id: address.id } as any)
        return response.ok(updated)
    }

    /**
     * Delete an address (Soft delete via isActive=false usually, but here hard delete for now)
     */
    async destroy({ params, response, auth }: HttpContext) {
        const address = await Address.find(params.id)
        if (!address) {
            return response.notFound({ message: 'Address not found' })
        }

        const user = auth.user!
        if (!(await this.canEditAddress(user, address.ownerType, address.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        await address.delete()
        return response.noContent()
    }

    /**
     * Set as default
     */
    async setDefault({ params, response, auth }: HttpContext) {
        const address = await Address.find(params.id)
        if (!address) {
            return response.notFound({ message: 'Address not found' })
        }

        const user = auth.user!
        if (!(await this.canEditAddress(user, address.ownerType, address.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        await AddressService.setDefault(address.id, address.ownerType, address.ownerId)
        return response.ok({ message: 'Default address updated' })
    }
}
