import Schedule, { ScheduleType, RecurrenceType, ScheduleOwnerType } from '#models/schedule'
import { DateTime } from 'luxon'

export class ScheduleService {
    /**
     * Get the effective schedule for a specific date and time
     * Resolves priority: SPECIFIC_DATE > DATE_RANGE > WEEKLY
     */
    async getEffectiveSchedule(
        ownerType: ScheduleOwnerType,
        ownerId: string,
        date: DateTime,
        userId?: string
    ): Promise<Schedule | null> {
        // Format dates for SQL comparison
        const dateStr = date.toFormat('yyyy-MM-dd')
        const jsDayOfWeek = date.toJSDate().getDay()

        const query = Schedule.query()
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .where('isActive', true)

        if (userId) {
            query.whereHas('assignedUsers', (sub) => {
                sub.where('user_id', userId)
            })
        }

        const schedule = await query
            .andWhere((q) => {
                q
                    // 1. Specific Date
                    .where((sub) => {
                        sub.where('recurrenceType', RecurrenceType.SPECIFIC_DATE)
                            .where('specificDate', dateStr)
                    })
                    // 2. Date Range
                    .orWhere((sub) => {
                        sub.where('recurrenceType', RecurrenceType.DATE_RANGE)
                            .where('startDate', '<=', dateStr)
                            .where('endDate', '>=', dateStr)
                    })
                    // 3. Weekly
                    .orWhere((sub) => {
                        sub.where('recurrenceType', RecurrenceType.WEEKLY)
                            .where('dayOfWeek', jsDayOfWeek)
                    })
                    // 4. Manual Override (Specific day but top priority)
                    .orWhere((sub) => {
                        sub.where('recurrenceType', RecurrenceType.MANUAL_OVERRIDE)
                            .where('specificDate', dateStr)
                    })
            })
            .orderBy('priority', 'desc')
            .orderBy('updatedAt', 'desc')
            .first()

        return schedule
    }

    /**
     * Check if owner is available at specific date/time
     */
    async isAvailable(
        ownerType: ScheduleOwnerType,
        ownerId: string,
        dateTime: DateTime
    ): Promise<boolean> {
        const schedule = await this.getEffectiveSchedule(ownerType, ownerId, dateTime)

        if (!schedule) {
            return false // No schedule = not available (default closed)
        }

        if (schedule.scheduleType === ScheduleType.CLOSED) {
            return false
        }

        // Check time range in the schedule's timezone
        const timezone = schedule.timezone || 'Africa/Abidjan'
        const localDateTime = dateTime.setZone(timezone)
        const timeStr = localDateTime.toFormat('HH:mm')

        return timeStr >= schedule.startTime && timeStr <= schedule.endTime
    }

    /**
     * Create weekly schedule (batch)
     */
    async createWeeklySchedule(
        ownerType: ScheduleOwnerType,
        ownerId: string,
        schedules: { dayOfWeek: number; startTime: string; endTime: string }[]
    ) {
        // Transaction could be nice here but keeping it simple for now
        const created = []
        for (const s of schedules) {
            created.push(await Schedule.create({
                ownerType,
                ownerId,
                scheduleType: ScheduleType.WORK, // Default, can be genericized
                recurrenceType: RecurrenceType.WEEKLY,
                dayOfWeek: s.dayOfWeek,
                startTime: s.startTime,
                endTime: s.endTime,
                isActive: true,
                timezone: 'Africa/Abidjan' // Default, should be passed
            }))
        }
        return created
    }

    /**
     * Add an exception (holiday, closed day, specific work day)
     */
    async addException(
        ownerType: ScheduleOwnerType,
        ownerId: string,
        date: DateTime,
        type: ScheduleType,
        reason?: string,
        startTime: string = '00:00',
        endTime: string = '00:00'
    ) {
        return await Schedule.create({
            ownerType,
            ownerId,
            scheduleType: type,
            recurrenceType: RecurrenceType.SPECIFIC_DATE,
            specificDate: date,
            startTime,
            endTime,
            label: reason,
            isActive: true
        })
    }
}

export default new ScheduleService()
