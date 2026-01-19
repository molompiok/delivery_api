import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, manyToMany } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import User from '#models/user'
import type { ManyToMany } from '@adonisjs/lucid/types/relations'

export enum ScheduleType {
    WORK = 'WORK',
    OPENING = 'OPENING',
    DELIVERY = 'DELIVERY',
    AVAILABILITY = 'AVAILABILITY',
    CLOSED = 'CLOSED',
}

export enum ScheduleCategory {
    WORK = 'WORK',
    LEAVE = 'LEAVE',
    MANAGEMENT = 'MANAGEMENT',
}

export enum RecurrenceType {
    WEEKLY = 'WEEKLY',
    SPECIFIC_DATE = 'SPECIFIC_DATE',
    DATE_RANGE = 'DATE_RANGE',
    MANUAL_OVERRIDE = 'MANUAL_OVERRIDE',
}

export interface ScheduleLink {
    name: string
    url: string
    icon?: string
}

export type ScheduleOwnerType = 'User' | 'Company' | 'Order' | 'Address'

export default class Schedule extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(schedule: Schedule) {
        schedule.id = generateId('sch')
    }

    @beforeCreate()
    static setDefaults(schedule: Schedule) {
        // Set default values if not provided
        if (!schedule.scheduleCategory) {
            schedule.scheduleCategory = ScheduleCategory.WORK
        }
        if (!schedule.scheduleType) {
            schedule.scheduleType = ScheduleType.WORK
        }
        if (!schedule.timezone) {
            schedule.timezone = 'UTC'
        }
        if (schedule.isActive === undefined) {
            schedule.isActive = true
        }
        if (schedule.isPublic === undefined) {
            schedule.isPublic = false
        }
        if (!schedule.priority) {
            schedule.priority = Schedule.getPriority(schedule.recurrenceType)
        }
        if (schedule.affectsAvailability === undefined) {
            schedule.affectsAvailability = schedule.scheduleCategory !== ScheduleCategory.MANAGEMENT
        }
    }

    // Polymorphic ownership
    @column()
    declare ownerType: ScheduleOwnerType

    @column()
    declare ownerId: string

    // Types
    @column()
    declare scheduleType: ScheduleType

    @column()
    declare scheduleCategory: ScheduleCategory

    @column()
    declare recurrenceType: RecurrenceType

    // WEEKLY
    @column()
    declare dayOfWeek: number | null // 0-6

    // SPECIFIC_DATE / DATE_RANGE
    @column.date()
    declare specificDate: DateTime | null

    @column.date()
    declare startDate: DateTime | null

    @column.date()
    declare endDate: DateTime | null

    // Time
    @column()
    declare startTime: string // HH:mm

    @column()
    declare endTime: string // HH:mm

    // Metadata
    @column()
    declare label: string | null

    @column()
    declare timezone: string

    @column()
    declare isActive: boolean

    @column()
    declare isPublic: boolean

    @column()
    declare priority: number

    // Advanced management fields
    @column()
    declare title: string | null

    @column()
    declare description: string | null

    @column()
    declare color: string | null

    @column()
    declare icon: string | null

    @column({
        prepare: (value: ScheduleLink[]) => JSON.stringify(value || [])
    })
    declare links: ScheduleLink[]

    @column()
    declare affectsAvailability: boolean

    // Many-to-many relationship with users
    @manyToMany(() => User, {
        pivotTable: 'schedule_assignments',
        localKey: 'id',
        pivotForeignKey: 'schedule_id',
        relatedKey: 'id',
        pivotRelatedForeignKey: 'user_id',
        pivotTimestamps: true
    })
    declare assignedUsers: ManyToMany<typeof User>

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    /**
     * Helper to determine priority based on recurrence type
     */
    static getPriority(recurrenceType: RecurrenceType): number {
        switch (recurrenceType) {
            case RecurrenceType.MANUAL_OVERRIDE:
                return 200
            case RecurrenceType.SPECIFIC_DATE:
                return 100
            case RecurrenceType.DATE_RANGE:
                return 50
            case RecurrenceType.WEEKLY:
                return 10
            default:
                return 0
        }
    }

    @beforeCreate()
    static assignPriority(schedule: Schedule) {
        if (!schedule.priority) {
            schedule.priority = Schedule.getPriority(schedule.recurrenceType)
        }
    }
}
