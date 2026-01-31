import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'

export type AddressOwnerType = 'User' | 'Company' | 'Order'

export default class Address extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(address: Address) {
        address.id = generateId('adr')
    }

    // Polymorphic ownership
    @column()
    declare ownerType: AddressOwnerType

    @column()
    declare ownerId: string

    // Metadata
    @column()
    declare label: string

    @column()
    declare isDefault: boolean

    @column()
    declare isActive: boolean

    // Geolocation
    @column()
    declare lat: number

    @column()
    declare lng: number

    // Address Details
    @column()
    declare formattedAddress: string

    @column()
    declare street: string | null

    @column()
    declare city: string | null

    @column()
    declare zipCode: string | null

    @column()
    declare country: string | null

    @column()
    declare details: string | null

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
