import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, hasMany, belongsTo, manyToMany, hasOne, computed } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import Vehicle from '#models/vehicle'
import CompanySubscriptionOverride from '#models/company_subscription_override'
import SubscriptionInvoice from '#models/subscription_invoice'
import type { HasMany, BelongsTo, ManyToMany, HasOne } from '@adonisjs/lucid/types/relations'
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

    @column({ columnName: 'logo', serializeAs: null })
    declare logoPath: string | null

    @column()
    declare description: string | null

    @column()
    declare taxId: string | null

    @column()
    declare ownerId: string

    @column()
    declare activityType: OrderTemplate

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

    @hasMany(() => User, { foreignKey: 'companyId' })
    declare employees: HasMany<typeof User>

    @manyToMany(() => User, {
        pivotTable: 'company_b2b_partners',
        pivotForeignKey: 'company_id',
        pivotRelatedForeignKey: 'client_id',
        pivotColumns: ['status']
    })
    declare b2bClients: ManyToMany<typeof User>

    @hasMany(() => Vehicle)
    declare vehicles: HasMany<typeof Vehicle>

    @hasOne(() => CompanySubscriptionOverride)
    declare subscriptionOverride: HasOne<typeof CompanySubscriptionOverride>

    @hasMany(() => SubscriptionInvoice)
    declare subscriptionInvoices: HasMany<typeof SubscriptionInvoice>

    @column()
    declare walletId: string | null

    @column()
    declare verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED'

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @computed()
    get logo() {
        const paths = this.$extras.logo || []
        if (paths.length > 0) return `fs/${paths[0]}`
        // Fallback to logoPath if loaded but extras not populated
        if (this.logoPath && typeof this.logoPath === 'string' && !this.logoPath.startsWith('{')) {
            return `fs/${this.logoPath}`
        }
        return null
    }

    async loadFiles() {
        const FileManager = (await import('#services/file_manager')).default
        this.$extras.logo = await FileManager.getPathsFor('Company', this.id, 'logo')
    }
}
