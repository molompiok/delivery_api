import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import Task from '#models/task'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class Shipment extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(shipment: Shipment) {
        shipment.id = generateId('shp')
    }

    @column()
    declare orderId: string

    @column()
    declare pickupTaskId: string

    @column()
    declare deliveryTaskId: string

    @column()
    declare status: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED' | 'CANCELLED'

    @column({
        prepare: (v) => v ? JSON.stringify(v) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare metadata: any

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => Order)
    declare order: BelongsTo<typeof Order>

    @belongsTo(() => Task, { foreignKey: 'pickupTaskId' })
    declare pickupTask: BelongsTo<typeof Task>

    @belongsTo(() => Task, { foreignKey: 'deliveryTaskId' })
    declare deliveryTask: BelongsTo<typeof Task>
}
