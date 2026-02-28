import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Company from '#models/company'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { OrderTemplate } from '#constants/order_templates'

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

    /**
     * CLÉ DE SÉLECTION : Définit à quel type d'ordre cette politique de paiement s'applique.
     * Contrairement à Company.activityType (Identité), ceci est un filtre opérationnel utilisé par le PaymentPolicyService.
     * Si null, cette politique sert de fallback pour toutes les activités de l'entité.
     */
    @column()
    declare template: OrderTemplate | null

    @column()
    declare clientPaymentTrigger: ClientPaymentTrigger

    @column()
    declare driverPaymentTrigger: DriverPaymentTrigger

    // Commission plateforme
    @column()
    declare platformCommissionPercent: number

    @column()
    declare platformCommissionFixed: number

    @column()
    declare platformCommissionExempt: boolean

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
