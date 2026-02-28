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
    @column({ serializeAs: 'owner_type' })
    declare ownerType: ScheduleOwnerType

    @column({ serializeAs: 'owner_id' })
    declare ownerId: string

    // Types
    @column({ serializeAs: 'schedule_type' })
    declare scheduleType: ScheduleType

    @column({ serializeAs: 'schedule_category' })
    declare scheduleCategory: ScheduleCategory

    @column({ serializeAs: 'recurrence_type' })
    declare recurrenceType: RecurrenceType

    // WEEKLY — multiple days (0=Sunday, 1=Monday, ..., 6=Saturday)
    @column({
        serializeAs: 'days_of_week',
        prepare: (value: number[]) => JSON.stringify(value || []),
        consume: (value: any) => {
            if (Array.isArray(value)) return value
            if (typeof value === 'string') {
                try { return JSON.parse(value) } catch { return [] }
            }
            return []
        }
    })
    declare daysOfWeek: number[]

    // SPECIFIC_DATE / DATE_RANGE
    @column.date({ serializeAs: 'specific_date' })
    declare specificDate: DateTime | null

    @column.date({ serializeAs: 'start_date' })
    declare startDate: DateTime | null

    @column.date({ serializeAs: 'end_date' })
    declare endDate: DateTime | null

    // Time
    @column({ serializeAs: 'start_time' })
    declare startTime: string // HH:mm

    @column({ serializeAs: 'end_time' })
    declare endTime: string // HH:mm

    // Metadata
    @column()
    declare label: string | null

    @column()
    declare timezone: string

    @column({ serializeAs: 'is_active' })
    declare isActive: boolean

    @column({ serializeAs: 'is_public' })
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

    @column({ serializeAs: 'affects_availability' })
    declare affectsAvailability: boolean

    // Many-to-many relationship with users
    @manyToMany(() => User, {
        pivotTable: 'schedule_assignments',
        localKey: 'id',
        pivotForeignKey: 'schedule_id',
        relatedKey: 'id',
        pivotRelatedForeignKey: 'user_id',
        pivotTimestamps: true,
        serializeAs: 'assigned_users'
    })
    declare assignedUsers: ManyToMany<typeof User>

    @column.dateTime({ autoCreate: true, serializeAs: 'created_at' })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true, serializeAs: 'updated_at' })
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
