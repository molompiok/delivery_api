import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Company from '#models/company'
import User from '#models/user'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import File from './file.js'
import Order from '#models/order'

export type VehicleOwnerType = 'User' | 'Company'
export type VehicleType = 'MOTO' | 'CAR_SEDAN' | 'VAN' | 'TRUCK' | 'BICYCLE'
export type VehicleEnergy = 'GASOLINE' | 'DIESEL' | 'ELECTRIC' | 'HYBRID'
export type VehicleStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export default class Vehicle extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(vehicle: Vehicle) {
        vehicle.id = generateId('vhc')
    }

    // Polymorphic ownership
    @column()
    declare ownerType: VehicleOwnerType

    @column()
    declare ownerId: string

    // Legacy Company Link (Optional now, kept for assignments)
    @column()
    declare companyId: string | null

    @column()
    declare assignedDriverId: string | null

    @belongsTo(() => Company)
    declare company: BelongsTo<typeof Company>

    @belongsTo(() => User, { foreignKey: 'assignedDriverId' })
    declare assignedDriver: BelongsTo<any>

    // Metadata
    @column()
    declare type: VehicleType

    @column()
    declare brand: string

    @column()
    declare model: string

    @column()
    declare plate: string

    @column()
    declare year: number | null

    @column()
    declare color: string | null

    @column()
    declare energy: VehicleEnergy

    // Logistics Specs
    @column()
    declare specs: {
        maxWeight?: number
        cargoVolume?: number
        height?: number
        length?: number
        width?: number
    } | null

    @hasMany(() => File, {
        foreignKey: 'tableId',
        onQuery: (query) => query.where('tableName', 'Vehicle')
    })
    declare files: HasMany<typeof File>

    @hasMany(() => Order)
    declare orders: HasMany<typeof Order>

    // Status
    @column()
    declare verificationStatus: VehicleStatus

    @column()
    declare isActive: boolean

    @column()
    declare metadata: {
        assignmentHistory?: Array<{
            driverId: string | null
            driverName: string
            managerId: string
            managerName: string
            action: 'ASSIGNED' | 'UNASSIGNED'
            timestamp: string
        }>
    } | null

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
