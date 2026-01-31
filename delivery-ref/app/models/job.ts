import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import Task from '#models/task'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class Job extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(job: Job) {
        job.id = generateId('job')
    }

    @column()
    declare orderId: string

    @column()
    declare taskId: string

    @column()
    declare status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

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

    @belongsTo(() => Task)
    declare task: BelongsTo<typeof Task>
}
