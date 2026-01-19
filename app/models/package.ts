import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class Package extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(pkg: Package) {
        pkg.id = generateId('pkg')
    }

    @column()
    declare orderId: string

    @column()
    declare name: string | null

    @column()
    declare description: string | null

    @column({
        prepare: (value: any) => value ? JSON.stringify(value) : null,
    })
    declare dimensionsJson: { weight_g: number, depth_cm?: number, width_cm?: number, height_cm?: number } | null

    @column()
    declare weight: number | null

    @column()
    declare quantity: number

    @column()
    declare fragility: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'

    @column()
    declare mentionWarning: string | null

    @column()
    declare isCold: boolean

    @belongsTo(() => Order)
    declare order: BelongsTo<typeof Order>

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
