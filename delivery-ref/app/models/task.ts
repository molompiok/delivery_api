import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import Mission from '#models/mission'
import Address from '#models/address'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class Task extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(task: Task) {
        task.id = generateId('tsk')
    }

    @column()
    declare orderId: string

    @column()
    declare missionId: string | null

    @column()
    declare addressId: string

    @column()
    declare type: 'PICKUP' | 'DELIVERY' | 'SERVICE'

    @column()
    declare status: 'PENDING' | 'ARRIVED' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

    @column()
    declare sequence: number | null

    @column()
    declare serviceTime: number

    @column.dateTime()
    declare arrivalTime: DateTime | null

    @column.dateTime()
    declare completionTime: DateTime | null

    @column()
    declare verificationCode: string | null

    @column()
    declare isVerified: boolean

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

    @belongsTo(() => Mission)
    declare mission: BelongsTo<typeof Mission>

    @belongsTo(() => Address)
    declare address: BelongsTo<typeof Address>
}
