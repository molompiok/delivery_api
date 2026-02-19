import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import CompanyDriverSetting from '#models/company_driver_setting'
import Company from '#models/company'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export type SalaryPaymentStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'FAILED'

export default class SalaryPayment extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(salary: SalaryPayment) {
        salary.id = generateId('sal')
    }

    @column()
    declare companyDriverSettingId: string

    @column()
    declare companyId: string

    @column()
    declare driverId: string

    @column.dateTime()
    declare periodStart: DateTime

    @column.dateTime()
    declare periodEnd: DateTime

    @column()
    declare baseSalary: number

    @column()
    declare bonuses: number

    @column()
    declare deductions: number

    @column()
    declare totalAmount: number

    @column()
    declare status: SalaryPaymentStatus

    // Référence wave-api
    @column()
    declare internalPaymentIntentId: string | null

    @column.dateTime()
    declare paidAt: DateTime | null

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => CompanyDriverSetting)
    declare companyDriverSetting: BelongsTo<typeof CompanyDriverSetting>

    @belongsTo(() => Company)
    declare company: BelongsTo<typeof Company>

    @belongsTo(() => User, { foreignKey: 'driverId' })
    declare driver: BelongsTo<typeof User>
}
