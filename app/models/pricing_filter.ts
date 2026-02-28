import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Company from '#models/company'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { OrderTemplate } from '#constants/order_templates'

export default class PricingFilter extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(filter: PricingFilter) {
        filter.id = generateId('pf')
    }

    @column()
    declare companyId: string | null

    @column()
    declare driverId: string | null

    @column()
    declare name: string

    /**
     * CLÉ DE SÉLECTION : Définit à quel type d'ordre ces règles de prix s'appliquent.
     * Contrairement à Company.activityType (Identité), ceci est un filtre opérationnel utilisé par le PricingFilterService.
     * Si null, cette règle sert de fallback pour toutes les activités de l'entité.
     */
    @column()
    declare template: OrderTemplate | null

    // --- Composantes du prix ---

    @column()
    declare baseFee: number

    // Distance
    @column()
    declare perKmRate: number

    @column()
    declare perMinuteRate: number

    @column()
    declare minDistance: number

    @column()
    declare maxDistance: number | null

    // Charge (poids/volume)
    @column()
    declare perKgRate: number

    @column()
    declare freeWeightKg: number

    @column({ columnName: 'per_m3_rate' })
    declare perM3Rate: number

    // Surcharges (multiplicateurs)
    @column()
    declare fragileMultiplier: number

    @column()
    declare urgentMultiplier: number

    @column()
    declare nightMultiplier: number

    // Réductions inter-stops (proximité)
    @column()
    declare proximityDiscountPercent: number

    @column()
    declare proximityThresholdKm: number

    // Charge excessive / légère
    @column()
    declare heavyLoadSurchargeThresholdKg: number

    @column()
    declare heavyLoadSurchargePercent: number

    @column()
    declare lightLoadDiscountThresholdKg: number

    @column()
    declare lightLoadDiscountPercent: number

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
