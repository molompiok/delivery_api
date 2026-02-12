import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, afterSave } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import Company from '#models/company'
import Zone from '#models/zone'
import Vehicle from '#models/vehicle'
import { WorkMode } from '#constants/work_mode'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class DriverSetting extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(driverSetting: DriverSetting) {
        driverSetting.id = generateId('ds')
    }

    @afterSave()
    static async syncToRedis(driverSetting: DriverSetting) {
        const RedisService = (await import('#services/redis_service')).default
        await RedisService.syncDriverToRedis(driverSetting.userId)
    }

    @column()
    declare userId: string

    @column()
    declare vehicleType: string | null

    @column()
    declare vehiclePlate: string | null

    @column({ columnName: 'company_id' })
    declare currentCompanyId: string | null

    @column()
    declare verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED'

    @column()
    declare status: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'PAUSE'

    @column()
    declare currentLat: number | null

    @column()
    declare currentLng: number | null

    @column()
    declare mileage: number

    @column()
    declare activeZoneId: string | null  // Zone active en mode IDEP

    @column()
    declare activeVehicleId: string | null  // Véhicule actif en mode IDEP

    @column()
    declare currentMode: WorkMode  // Mode de travail actuel (IDEP, ETP, transitions)

    @column()
    declare allowChaining: boolean  // Autoriser le chaînage de missions

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime

    @belongsTo(() => User)
    declare user: BelongsTo<typeof User>

    @belongsTo(() => Company, {
        foreignKey: 'currentCompanyId'
    })
    declare currentCompany: BelongsTo<typeof Company>

    @belongsTo(() => Zone, {
        foreignKey: 'activeZoneId'
    })
    declare activeZone: BelongsTo<typeof Zone>

    @belongsTo(() => Vehicle, {
        foreignKey: 'activeVehicleId'
    })
    declare activeVehicle: BelongsTo<typeof Vehicle>
}
