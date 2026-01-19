import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, hasMany, afterSave } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import Company from '#models/company'
import Document from '#models/document'
import Zone from '#models/zone'
import Vehicle from '#models/vehicle'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

export type CompanyDriverStatus = 'PENDING_ACCESS' | 'ACCESS_ACCEPTED' | 'PENDING_FLEET' | 'ACCEPTED' | 'REJECTED' | 'REMOVED'

export default class CompanyDriverSetting extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(setting: CompanyDriverSetting) {
        setting.id = generateId('cds')
    }

    @afterSave()
    static async syncToRedis(setting: CompanyDriverSetting) {
        const RedisService = (await import('#services/redis_service')).default
        await RedisService.syncDriverToRedis(setting.driverId)
    }

    @column()
    declare companyId: string

    @column()
    declare driverId: string

    @column()
    declare status: CompanyDriverStatus

    @column.dateTime()
    declare invitedAt: DateTime

    @column.dateTime()
    declare acceptedAt: DateTime | null

    @column()
    declare docsStatus: 'PENDING' | 'APPROVED' | 'REJECTED'

    @column({
        prepare: (value: string[]) => JSON.stringify(value || []),
    })
    declare requiredDocTypes: string[]

    @column()
    declare activeZoneId: string | null  // Zone active en mode ETP pour cette entreprise

    @column()
    declare activeVehicleId: string | null  // Véhicule actif en mode ETP pour cette entreprise

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime

    @belongsTo(() => Company)
    declare company: BelongsTo<typeof Company>

    @belongsTo(() => User, {
        foreignKey: 'driverId'
    })
    declare driver: BelongsTo<typeof User>

    @belongsTo(() => Zone, {
        foreignKey: 'activeZoneId'
    })
    declare activeZone: BelongsTo<typeof Zone>

    @belongsTo(() => Vehicle, {
        foreignKey: 'activeVehicleId'
    })
    declare activeVehicle: BelongsTo<typeof Vehicle>

    @hasMany(() => Document, {
        foreignKey: 'tableId',
        onQuery: (q) => q.where('tableName', 'CompanyDriverSetting')
    })
    declare documents: HasMany<typeof Document>
}
