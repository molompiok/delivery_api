import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, hasMany, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import Vehicle from '#models/vehicle'
import type { HasMany, BelongsTo } from '@adonisjs/lucid/types/relations'
import type { OrderTemplate } from '#constants/order_templates'

export default class Company extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(company: Company) {
        company.id = generateId('cmp')
    }

    @column()
    declare name: string

    @column()
    declare registreCommerce: string | null

    @column()
    declare logo: string | null

    @column()
    declare description: string | null

    @column()
    declare taxId: string | null

    @column()
    declare ownerId: string

    /**
     * Identité structurelle de l'entreprise (ex: Livraison, VTC, Services).
     * Définit le cœur de métier et déverrouille les fonctionnalités liées.
     */
    @column()
    declare activityType: OrderTemplate

    /**
     * Préférence d'usage au quotidien pour la création de commandes.
     * Peut être différent de l'activityType si l'entreprise diversifie ponctuellement ses activités.
     */
    @column()
    declare defaultTemplate: OrderTemplate | null

    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : JSON.stringify({}),
    })
    declare settings: any

    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : JSON.stringify({}),
    })
    declare metaData: any

    @belongsTo(() => User, { foreignKey: 'ownerId' })
    declare owner: BelongsTo<typeof User>

    @hasMany(() => User)
    declare employees: HasMany<typeof User>

    @hasMany(() => Vehicle)
    declare vehicles: HasMany<typeof Vehicle>

    @column()
    declare walletId: string | null

    @column()
    declare verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED'

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
