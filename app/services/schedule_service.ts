import Schedule, { ScheduleType, RecurrenceType, ScheduleOwnerType } from '#models/schedule'
import { DateTime } from 'luxon'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import { generateId } from '../utils/id_generator.js'
import { inject } from '@adonisjs/core'

@inject()
export default class ScheduleService {
    /**
     * Check if a user can view a schedule
     */
    async canViewSchedule(user: User, ownerType: string, ownerId: string, schedule: Schedule | null = null): Promise<boolean> {
        if (user.isAdmin) return true
        if (schedule && schedule.isPublic) return true
        if (ownerType === 'User' && ownerId === user.id) return true
        if (ownerType === 'Company') {
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (activeCompanyId === ownerId) return true
        }
        if (ownerType === 'User') {
            const driver = await User.find(ownerId)
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (driver && driver.companyId === activeCompanyId) return true
        }
        return false
    }

    /**
     * Check if a user can edit a schedule
     */
    async canEditSchedule(user: User, ownerType: string, ownerId: string): Promise<boolean> {
        if (user.isAdmin) return true
        if (ownerType === 'User' && ownerId === user.id) return true
        if (ownerType === 'Company') {
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (activeCompanyId === ownerId) return true
        }
        if (ownerType === 'User') {
            const driver = await User.find(ownerId)
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (driver && driver.companyId === activeCompanyId) return true
        }
        return false
    }

    /**
     * List schedules for an owner with permission check
     */
    async listSchedules(user: User, ownerType: string, ownerId: string) {
        const schedules = await Schedule.query()
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .orderBy('priority', 'desc')
            .orderBy('createdAt', 'desc')

        const filtered = await Promise.all(schedules.map(async (s) => {
            return await this.canViewSchedule(user, ownerType, ownerId, s) ? s : null
        }))

        return filtered.filter(s => s !== null) as Schedule[]
    }

    /**
     * Get single schedule details
     */
    async getScheduleDetails(user: User, scheduleId: string) {
        const schedule = await Schedule.findOrFail(scheduleId)
        if (!await this.canViewSchedule(user, schedule.ownerType, schedule.ownerId, schedule)) {
            throw new Error('Unauthorized to view this schedule')
        }
        return schedule
    }

    /**
     * Create or update a schedule
     */
    async saveSchedule(user: User, data: any) {
        if (!await this.canEditSchedule(user, data.ownerType, data.ownerId)) {
            throw new Error('Unauthorized to manage schedules for this owner')
        }

        const trx = await db.transaction()
        try {
            if (data.id) {
                const schedule = await Schedule.query({ client: trx }).where('id', data.id).forUpdate().firstOrFail()
                if (schedule.ownerType !== data.ownerType || schedule.ownerId !== data.ownerId) {
                    throw new Error('Schedule ownership mismatch')
                }
                schedule.merge(data)
                await schedule.useTransaction(trx).save()
                await trx.commit()
                return schedule
            } else {
                const schedule = await Schedule.create(data, { client: trx })
                await trx.commit()
                return schedule
            }
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Delete a schedule
     */
    async deleteSchedule(user: User, scheduleId: string) {
        const trx = await db.transaction()
        try {
            const schedule = await Schedule.query({ client: trx }).where('id', scheduleId).forUpdate().firstOrFail()
            if (!await this.canEditSchedule(user, schedule.ownerType, schedule.ownerId)) {
                throw new Error('Unauthorized to delete this schedule')
            }
            await schedule.useTransaction(trx).delete()
            await trx.commit()
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Assign users to a schedule
     */
    async assignUsers(user: User, scheduleId: string, userIds: string[]) {
        const trx = await db.transaction()
        try {
            const schedule = await Schedule.query({ client: trx }).where('id', scheduleId).forUpdate().firstOrFail()
            if (!await this.canEditSchedule(user, schedule.ownerType, schedule.ownerId)) {
                throw new Error('Unauthorized')
            }

            await schedule.related('assignedUsers').attach(
                userIds.reduce((acc, targetUserId) => {
                    acc[targetUserId] = {
                        id: generateId('sas'),
                        assigned_by: user.id,
                        created_at: DateTime.now().toSQL(),
                        updated_at: DateTime.now().toSQL()
                    }
                    return acc
                }, {} as Record<string, any>),
                trx
            )
            await trx.commit()
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Unassign users from a schedule
     */
    async unassignUsers(user: User, scheduleId: string, userIds: string[]) {
        const trx = await db.transaction()
        try {
            const schedule = await Schedule.query({ client: trx }).where('id', scheduleId).forUpdate().firstOrFail()
            if (!await this.canEditSchedule(user, schedule.ownerType, schedule.ownerId)) {
                throw new Error('Unauthorized')
            }
            await schedule.related('assignedUsers').detach(userIds, trx)
            await trx.commit()
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Get assigned users
     */
    async getAssignedUsers(user: User, scheduleId: string) {
        const schedule = await Schedule.query()
            .where('id', scheduleId)
            .preload('assignedUsers', (query) => {
                query.select('id', 'fullName', 'email', 'phone')
            })
            .firstOrFail()

        if (!await this.canViewSchedule(user, schedule.ownerType, schedule.ownerId, schedule)) {
            throw new Error('Unauthorized')
        }

        return schedule.assignedUsers
    }

    /**
     * Get the effective schedule for a specific date and time
     */
    async getEffectiveSchedule(
        ownerType: ScheduleOwnerType,
        ownerId: string,
        date: DateTime,
        userId?: string
    ): Promise<Schedule | null> {
        const dateStr = date.toFormat('yyyy-MM-dd')
        // Luxon 1-7 (Monday-Sunday)
        // Wait, JS is 0-6. Let's use Luxon's weekday (1-7) but check model expectation.
        // Usually dayOfWeek in DB is 0-6 or 1-7. Previous code used toJSDate().getDay() (0-6).
        const jsDay = date.toJSDate().getDay()

        const query = Schedule.query()
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .where('isActive', true)

        if (userId) {
            query.whereHas('assignedUsers', (sub) => {
                sub.where('user_id', userId)
            })
        }

        return await query
            .andWhere((q) => {
                q.where((sub) => {
                    sub.where('recurrenceType', RecurrenceType.SPECIFIC_DATE).where('specificDate', dateStr)
                }).orWhere((sub) => {
                    sub.where('recurrenceType', RecurrenceType.DATE_RANGE).where('startDate', '<=', dateStr).where('endDate', '>=', dateStr)
                }).orWhere((sub) => {
                    sub.where('recurrenceType', RecurrenceType.WEEKLY).where('dayOfWeek', jsDay)
                }).orWhere((sub) => {
                    sub.where('recurrenceType', RecurrenceType.MANUAL_OVERRIDE).where('specificDate', dateStr)
                })
            })
            .orderBy('priority', 'desc')
            .orderBy('updatedAt', 'desc')
            .first()
    }

    /**
     * Check availability
     */
    async isAvailable(ownerType: ScheduleOwnerType, ownerId: string, dateTime: DateTime): Promise<boolean> {
        const schedule = await this.getEffectiveSchedule(ownerType, ownerId, dateTime)
        if (!schedule || schedule.scheduleType === ScheduleType.CLOSED) return false

        const timezone = schedule.timezone || 'Africa/Abidjan'
        const localDateTime = dateTime.setZone(timezone)
        const timeStr = localDateTime.toFormat('HH:mm')

        return timeStr >= schedule.startTime && timeStr <= schedule.endTime
    }

    /**
     * Get calendar view
     */
    async getCalendarView(user: User, params: { view: string, date: string, ownerId: string, ownerType: string }) {
        const targetDate = DateTime.fromISO(params.date)
        if (!targetDate.isValid) throw new Error('Invalid date')

        let startDate: DateTime
        let endDate: DateTime

        switch (params.view) {
            case 'day': startDate = targetDate.startOf('day'); endDate = targetDate.endOf('day'); break
            case 'week': startDate = targetDate.startOf('week'); endDate = targetDate.endOf('week'); break
            case 'month': startDate = targetDate.startOf('month'); endDate = targetDate.endOf('month'); break
            default: throw new Error('Invalid view')
        }

        const schedules = await Schedule.query()
            .where('ownerType', params.ownerType)
            .where('ownerId', params.ownerId)
            .where('isActive', true)
            .preload('assignedUsers', (query) => query.select('id', 'fullName', 'email'))

        const filtered = await Promise.all(schedules.map(async (s) => {
            if (!await this.canViewSchedule(user, params.ownerType, params.ownerId, s)) return null

            if (s.recurrenceType === 'WEEKLY') return s // Simplified

            if (s.recurrenceType === 'SPECIFIC_DATE' && s.specificDate) {
                const sDate = DateTime.fromJSDate(s.specificDate.toJSDate())
                return (sDate >= startDate && sDate <= endDate) ? s : null
            }
            if (s.recurrenceType === 'DATE_RANGE' && s.startDate && s.endDate) {
                const sStart = DateTime.fromJSDate(s.startDate.toJSDate())
                const sEnd = DateTime.fromJSDate(s.endDate.toJSDate())
                return (sStart <= endDate && sEnd >= startDate) ? s : null
            }
            return null
        }))

        return {
            schedules: filtered.filter(s => s !== null),
            startDate: startDate.toISO(),
            endDate: endDate.toISO(),
            view: params.view
        }
    }
}
