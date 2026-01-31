import Address, { AddressOwnerType } from '#models/address'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { inject } from '@adonisjs/core'

@inject()
export default class AddressService {
    /**
     * Check if a user can edit an address
     */
    async canEditAddress(user: User, ownerType: string, ownerId: string): Promise<boolean> {
        if (user.isAdmin) return true

        if (ownerType === 'User' && ownerId === user.id) return true

        if (ownerType === 'Company') {
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (activeCompanyId === ownerId) return true
        }

        return false
    }

    /**
     * List addresses for an owner with permission check
     */
    async listAddresses(user: User, ownerType: string, ownerId: string) {
        if (!await this.canEditAddress(user, ownerType, ownerId)) {
            throw new Error('Unauthorized to view these addresses')
        }

        return await Address.query()
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .where('isActive', true)
            .orderBy('isDefault', 'desc')
            .orderBy('createdAt', 'desc')
    }

    /**
     * Create or update an address
     */
    async saveAddress(user: User, data: any) {
        if (!await this.canEditAddress(user, data.ownerType, data.ownerId)) {
            throw new Error('Unauthorized to manage addresses for this owner')
        }

        const trx = await db.transaction()
        try {
            if (data.isDefault) {
                await this.unsetDefault(data.ownerType as AddressOwnerType, data.ownerId, trx)
            } else {
                const hasDefault = await Address.query({ client: trx })
                    .where('ownerType', data.ownerType)
                    .where('ownerId', data.ownerId)
                    .where('isDefault', true)
                    .first()

                if (!hasDefault) {
                    data.isDefault = true
                }
            }

            if (data.id) {
                const address = await Address.query({ client: trx }).where('id', data.id).forUpdate().firstOrFail()
                if (address.ownerType !== data.ownerType || address.ownerId !== data.ownerId) {
                    throw new Error('Address ownership mismatch')
                }
                address.merge(data)
                await address.useTransaction(trx).save()
                await trx.commit()
                return address
            } else {
                const address = await Address.create(data, { client: trx })
                await trx.commit()
                return address
            }
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Delete an address
     */
    async deleteAddress(user: User, addressId: string) {
        const trx = await db.transaction()
        try {
            const address = await Address.query({ client: trx }).where('id', addressId).forUpdate().firstOrFail()
            if (!await this.canEditAddress(user, address.ownerType, address.ownerId)) {
                throw new Error('Unauthorized to delete this address')
            }
            await address.useTransaction(trx).delete()
            await trx.commit()
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Unset all defaults for an owner
     */
    async unsetDefault(ownerType: AddressOwnerType, ownerId: string, trx?: any) {
        await Address.query({ client: trx || db })
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .update({ isDefault: false })
    }

    /**
     * Set a specific address as default
     */
    async setDefault(user: User, addressId: string) {
        const trx = await db.transaction()
        try {
            const address = await Address.query({ client: trx }).where('id', addressId).forUpdate().firstOrFail()
            if (!await this.canEditAddress(user, address.ownerType, address.ownerId)) {
                throw new Error('Unauthorized to update default address')
            }

            await this.unsetDefault(address.ownerType, address.ownerId, trx)
            address.isDefault = true
            await address.useTransaction(trx).save()
            await trx.commit()
            return address
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }
}
