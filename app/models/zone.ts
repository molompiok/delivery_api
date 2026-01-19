import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Company from '#models/company'
import User from '#models/user'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export type ZoneOwnerType = 'Company' | 'User' | 'Sublymus'

export default class Zone extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(zone: Zone) {
        zone.id = generateId('zn')
    }

    @column()
    declare ownerType: ZoneOwnerType

    @column()
    declare ownerId: string | null  // null si ownerType = 'Sublymus'

    @column()
    declare sourceZoneId: string | null  // ID de la zone Sublymus source (si copie)

    @column()
    declare name: string

    @column()
    declare color: string

    @column()
    declare sector: string | null

    @column()
    declare type: 'circle' | 'polygon' | 'rectangle'

    @column()
    declare geometry: any // JSON object

    @column()
    declare isActive: boolean

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime

    @belongsTo(() => Company, {
        foreignKey: 'ownerId'
    })
    declare company: BelongsTo<typeof Company>

    @belongsTo(() => User, {
        foreignKey: 'ownerId'
    })
    declare user: BelongsTo<typeof User>

    @belongsTo(() => Zone, {
        foreignKey: 'sourceZoneId'
    })
    declare sourceZone: BelongsTo<typeof Zone>

    /**
     * Get drivers who have this zone as their active zone
     * - For User/Sublymus zones: looks in DriverSetting.activeZoneId
     * - For Company zones: looks in CompanyDriverSetting.activeZoneId
     */
    async getActiveDrivers(): Promise<User[]> {
        if (this.ownerType === 'Company') {
            // For Company zones, look in CompanyDriverSetting
            const { default: CompanyDriverSetting } = await import('#models/company_driver_setting')
            const settings = await CompanyDriverSetting.query()
                .where('activeZoneId', this.id)
                .preload('driver')
            return settings.map(s => s.driver)
        } else {
            // For User and Sublymus zones, look in DriverSetting
            const { default: DriverSetting } = await import('#models/driver_setting')
            const settings = await DriverSetting.query()
                .where('activeZoneId', this.id)
                .preload('user')
            return settings.map(s => s.user)
        }
    }

    /**
     * Copy a Sublymus zone to a Company or User
     * Creates a new zone with the same geometry and properties
     */
    static async installFromSublymus(
        sourceZoneId: string,
        targetOwnerType: 'Company' | 'User',
        targetOwnerId: string
    ): Promise<Zone> {
        const source = await Zone.findOrFail(sourceZoneId)

        if (source.ownerType !== 'Sublymus') {
            throw new Error('Can only install from Sublymus zones')
        }

        const copy = await Zone.create({
            name: source.name,
            color: source.color,
            sector: source.sector,
            type: source.type,
            geometry: { ...source.geometry },
            isActive: true,
            ownerType: targetOwnerType,
            ownerId: targetOwnerId,
            sourceZoneId: source.id
        })

        return copy
    }
}

