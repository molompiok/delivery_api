import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Company from '#models/company'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export type ClientPaymentTrigger = 'BEFORE_START' | 'ON_DELIVERY' | 'PROGRESSIVE' | 'ON_ACCEPT'
export type DriverPaymentTrigger = 'ON_DELIVERY' | 'PROGRESSIVE' | 'SALARY' | 'END_OF_PERIOD'

export default class PaymentPolicy extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(policy: PaymentPolicy) {
        policy.id = generateId('pp')
    }

    @column()
    declare companyId: string | null

    @column()
    declare driverId: string | null

    @column()
    declare name: string

    @column()
    declare domain: string | null

    @column()
    declare clientPaymentTrigger: ClientPaymentTrigger

    @column()
    declare driverPaymentTrigger: DriverPaymentTrigger

    // Commission plateforme
    @column()
    declare platformCommissionPercent: number

    @column()
    declare platformCommissionFixed: number

    // Commission entreprise
    @column()
    declare companyCommissionPercent: number

    @column()
    declare companyCommissionFixed: number

    // Progressif
    @column()
    declare progressiveMinAmount: number | null

    // COD
    @column()
    declare allowCod: boolean

    @column()
    declare codFeePercent: number

    @column()
    declare isDefault: boolean

    @column()
    declare isActive: boolean

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => Company)
    declare company: BelongsTo<typeof Company>

    @belongsTo(() => User, { foreignKey: 'driverId' })
    declare driver: BelongsTo<typeof User>
}
