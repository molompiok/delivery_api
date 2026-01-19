import Address, { AddressOwnerType } from '#models/address'

export class AddressService {
    /**
     * Create or update an address, handling default address logic
     */
    async saveAddress(data: Partial<Address> & { ownerType: AddressOwnerType, ownerId: string }) {
        // If this address is set as default, unset others for this owner
        if (data.isDefault) {
            await this.unsetDefault(data.ownerType, data.ownerId)
        } else {
            // If no default exists, force this one to be default (optional rule, good UX)
            const hasDefault = await Address.query()
                .where('ownerType', data.ownerType)
                .where('ownerId', data.ownerId)
                .where('isDefault', true)
                .first()

            if (!hasDefault) {
                data.isDefault = true
            }
        }

        if (data.id) {
            const address = await Address.findOrFail(data.id)
            address.merge(data)
            await address.save()
            return address
        } else {
            return await Address.create(data)
        }
    }

    /**
     * Set all addresses for an owner to isDefault=false
     */
    async unsetDefault(ownerType: AddressOwnerType, ownerId: string) {
        await Address.query()
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .update({ isDefault: false })
    }

    /**
     * Set a specific address as default
     */
    async setDefault(addressId: string, ownerType: AddressOwnerType, ownerId: string) {
        // Unset all first
        await this.unsetDefault(ownerType, ownerId)

        // Set specific one
        const address = await Address.findOrFail(addressId)
        // Verify ownership matches
        if (address.ownerType !== ownerType || address.ownerId !== ownerId) {
            throw new Error('Address ownership mismatch')
        }

        address.isDefault = true
        await address.save()
        return address
    }
}

export default new AddressService()
