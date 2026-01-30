import type { HttpContext } from '@adonisjs/core/http'
import ScheduleService from '#services/schedule_service'
import Schedule, { ScheduleOwnerType } from '#models/schedule'
import { DateTime } from 'luxon'
import User from '#models/user'
import { generateId } from '../utils/id_generator.js'

export default class ScheduleController {

    private async canViewSchedule(user: User, ownerType: string, ownerId: string, schedule: Schedule | null = null): Promise<boolean> {
        if (user.isAdmin) return true;

        // 1. Public schedule? (Accessible to any authenticated user)
        if (schedule && schedule.isPublic) return true;

        // 2. My own schedule?
        if (ownerType === 'User' && ownerId === user.id) return true;

        // 3. Manager accessing Company schedule?
        if (ownerType === 'Company') {
            if (user.effectiveCompanyId === ownerId && user.currentCompanyManaged) return true;
        }

        // 4. Manager accessing Driver schedule?
        if (ownerType === 'User') {
            const driver = await User.find(ownerId)
            // If checking a driver who belongs to my company
            if (driver && driver.companyId === user.effectiveCompanyId && user.currentCompanyManaged) return true;
        }

        return false;
    }

    private async canEditSchedule(user: User, ownerType: string, ownerId: string): Promise<boolean> {
        if (user.isAdmin) return true;

        // 1. My own schedule
        if (ownerType === 'User' && ownerId === user.id) return true;

        // 2. Manager managing company schedule
        if (ownerType === 'Company') {
            if (user.effectiveCompanyId === ownerId && user.currentCompanyManaged) return true;
        }

        // 3. Manager managing driver schedule
        if (ownerType === 'User') {
            const driver = await User.find(ownerId)
            if (driver && driver.companyId === user.effectiveCompanyId && user.currentCompanyManaged) return true;
        }

        return false;
    }

    /**
     * List schedules for an owner
     */
    async index({ request, response, auth }: HttpContext) {
        const { ownerType, ownerId } = request.qs()
        const user = auth.user!

        if (!ownerType || !ownerId) {
            return response.badRequest({ message: 'ownerType and ownerId are required' })
        }

        // Check permission strictly before fetching
        // Note: For listing, we can't check specific schedule.isPublic yet.
        // We fetch first, then filter, OR we trust generic permission check?
        // Better: Fetch all, then filter. Or allow if public access is possible.
        // Let's implement filtering directly in query for efficiency.

        const query = Schedule.query()
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .orderBy('priority', 'desc')
            .orderBy('createdAt', 'desc')

        const schedules = await query

        // Filter results based on permission
        const initialFiltered = await Promise.all(schedules.map(async (s) => {
            return await this.canViewSchedule(user, ownerType, ownerId, s) ? s : null
        }))

        const finalSchedules = initialFiltered.filter(s => s !== null)

        return response.ok(finalSchedules)
    }

    /**
     * Get a specific schedule
     */
    async show({ params, response, auth }: HttpContext) {
        const schedule = await Schedule.find(params.id)
        if (!schedule) {
            return response.notFound({ message: 'Schedule not found' })
        }

        const user = auth.user!
        if (!(await this.canViewSchedule(user, schedule.ownerType, schedule.ownerId, schedule))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        return response.ok(schedule)
    }

    /**
     * Create a new schedule
     */
    async store({ request, response, auth }: HttpContext) {
        const data = request.only([
            'ownerType', 'ownerId', 'scheduleType', 'scheduleCategory', 'recurrenceType',
            'dayOfWeek', 'specificDate', 'startDate', 'endDate',
            'startTime', 'endTime', 'label', 'timezone', 'isPublic',
            'title', 'description', 'color', 'icon', 'links', 'affectsAvailability'
        ])
        const user = auth.user!

        // Basic validation
        if (!data.ownerType || !data.ownerId || !data.startTime || !data.endTime) {
            return response.badRequest({ message: 'Missing required fields' })
        }

        if (!(await this.canEditSchedule(user, data.ownerType, data.ownerId))) {
            return response.forbidden({ message: 'You do not have permission to create schedules for this owner' })
        }

        const schedule = await Schedule.create(data)
        return response.created(schedule)
    }

    /**
     * Update a schedule
     */
    async update({ params, request, response, auth }: HttpContext) {
        const schedule = await Schedule.find(params.id)
        if (!schedule) {
            return response.notFound({ message: 'Schedule not found' })
        }

        const user = auth.user!
        if (!(await this.canEditSchedule(user, schedule.ownerType, schedule.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        const data = request.only([
            'scheduleType', 'scheduleCategory', 'recurrenceType',
            'dayOfWeek', 'specificDate', 'startDate', 'endDate',
            'startTime', 'endTime', 'label', 'isActive', 'isPublic',
            'title', 'description', 'color', 'icon', 'links', 'affectsAvailability'
        ])

        schedule.merge(data)
        await schedule.save()

        // Sync users if userIds provided
        const { userIds } = request.only(['userIds'])
        if (userIds && Array.isArray(userIds)) {
            await schedule.related('assignedUsers').sync(
                userIds.reduce((acc, userId) => {
                    acc[userId] = {
                        id: generateId('sas'),
                        assigned_by: user.id,
                        created_at: DateTime.now().toSQL(),
                        updated_at: DateTime.now().toSQL()
                    }
                    return acc
                }, {} as Record<string, any>)
            )
        }

        return response.ok(schedule)
    }

    /**
     * Delete a schedule
     */
    async destroy({ params, response, auth }: HttpContext) {
        const schedule = await Schedule.find(params.id)
        if (!schedule) {
            return response.notFound({ message: 'Schedule not found' })
        }

        const user = auth.user!
        if (!(await this.canEditSchedule(user, schedule.ownerType, schedule.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        await schedule.delete()
        return response.noContent()
    }

    /**
     * Check availability
     */
    async checkAvailability({ request, response, auth }: HttpContext) {
        const { ownerType, ownerId, date } = request.qs()
        const user = auth.user!

        if (!ownerType || !ownerId || !date) {
            return response.badRequest({ message: 'ownerType, ownerId and date (ISO) are required' })
        }

        const dateTime = DateTime.fromISO(date)
        if (!dateTime.isValid) {
            return response.badRequest({ message: 'Invalid date format' })
        }

        // Get effective schedule first to check visibility
        const effectiveSchedule = await ScheduleService.getEffectiveSchedule(
            ownerType as ScheduleOwnerType,
            ownerId,
            dateTime
        )

        // Check if user can view this schedule
        // If no schedule exists, we still might need to check general permission?
        // Fallback: Check generic permission without schedule object (isPublic assumed false if no schedule)
        // Actually, if effectiveSchedule is null (default closed), is it public info? Usually yes.
        // Let's say yes for now, or check explicit canView.

        const canView = await this.canViewSchedule(user, ownerType, ownerId, effectiveSchedule)

        if (!canView) {
            // If not visible, return generic "unavailable" or verify stricter privacy?
            // Returning 403 prevents leaking existence?
            return response.forbidden({ message: 'Access to this schedule information is restricted' })
        }

        const isAvailable = await ScheduleService.isAvailable(
            ownerType as ScheduleOwnerType,
            ownerId,
            dateTime
        )

        return response.ok({
            isAvailable,
            effectiveSchedule
        })
    }

    /**
     * Assign users to a schedule
     */
    async assignUsers({ params, request, response, auth }: HttpContext) {
        const schedule = await Schedule.find(params.id)
        if (!schedule) {
            return response.notFound({ message: 'Schedule not found' })
        }

        const user = auth.user!
        if (!(await this.canEditSchedule(user, schedule.ownerType, schedule.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        const { userIds } = request.only(['userIds'])
        if (!userIds || !Array.isArray(userIds)) {
            return response.badRequest({ message: 'userIds must be an array' })
        }

        // Attach users with pivot data
        // Explicitly generating IDs as attach() won't do it for string primary keys
        await schedule.related('assignedUsers').attach(
            userIds.reduce((acc, userId) => {
                acc[userId] = {
                    id: generateId('sas'),
                    assigned_by: user.id,
                    created_at: DateTime.now().toSQL(),
                    updated_at: DateTime.now().toSQL()
                }
                return acc
            }, {} as Record<string, any>)
        )

        return response.ok({ message: 'Users assigned successfully' })
    }

    /**
     * Unassign users from a schedule
     */
    async unassignUsers({ params, request, response, auth }: HttpContext) {
        const schedule = await Schedule.find(params.id)
        if (!schedule) {
            return response.notFound({ message: 'Schedule not found' })
        }

        const user = auth.user!
        if (!(await this.canEditSchedule(user, schedule.ownerType, schedule.ownerId))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        const { userIds } = request.only(['userIds'])
        if (!userIds || !Array.isArray(userIds)) {
            return response.badRequest({ message: 'userIds must be an array' })
        }

        await schedule.related('assignedUsers').detach(userIds)

        return response.ok({ message: 'Users unassigned successfully' })
    }

    /**
     * Get assigned users for a schedule
     */
    async getAssignedUsers({ params, response, auth }: HttpContext) {
        const schedule = await Schedule.query()
            .where('id', params.id)
            .preload('assignedUsers', (query) => {
                query.select('id', 'fullName', 'email', 'phone')
            })
            .first()

        if (!schedule) {
            return response.notFound({ message: 'Schedule not found' })
        }

        const user = auth.user!
        if (!(await this.canViewSchedule(user, schedule.ownerType, schedule.ownerId, schedule))) {
            return response.forbidden({ message: 'Permission denied' })
        }

        return response.ok(schedule.assignedUsers)
    }

    /**
     * Get calendar view (day/week/month)
     */
    async getCalendarView({ request, response }: HttpContext) {
        const { view, date, ownerId, ownerType } = request.qs()

        if (!view || !date || !ownerId || !ownerType) {
            return response.badRequest({ message: 'view, date, ownerId and ownerType are required' })
        }

        // Parse date
        const targetDate = DateTime.fromISO(date)
        if (!targetDate.isValid) {
            return response.badRequest({ message: 'Invalid date format' })
        }

        // Calculate date range based on view
        let startDate: DateTime
        let endDate: DateTime

        switch (view) {
            case 'day':
                startDate = targetDate.startOf('day')
                endDate = targetDate.endOf('day')
                break
            case 'week':
                startDate = targetDate.startOf('week')
                endDate = targetDate.endOf('week')
                break
            case 'month':
                startDate = targetDate.startOf('month')
                endDate = targetDate.endOf('month')
                break
            default:
                return response.badRequest({ message: 'Invalid view. Must be day, week, or month' })
        }

        // Get all schedules for this owner
        const schedules = await Schedule.query()
            .where('ownerType', ownerType)
            .where('ownerId', ownerId)
            .where('isActive', true)
            .preload('assignedUsers', (query) => {
                query.select('id', 'fullName', 'email')
            })

        // Filter schedules that apply to this date range
        const relevantSchedules = schedules.filter(schedule => {
            if (schedule.recurrenceType === 'WEEKLY') {
                // Check if any day in the range matches the dayOfWeek
                return true // Simplified - would need proper day matching
            }
            if (schedule.recurrenceType === 'SPECIFIC_DATE' && schedule.specificDate) {
                const scheduleDate = DateTime.fromJSDate(schedule.specificDate.toJSDate())
                return scheduleDate >= startDate && scheduleDate <= endDate
            }
            if (schedule.recurrenceType === 'DATE_RANGE' && schedule.startDate && schedule.endDate) {
                const schedStart = DateTime.fromJSDate(schedule.startDate.toJSDate())
                const schedEnd = DateTime.fromJSDate(schedule.endDate.toJSDate())
                // Check for overlap
                return schedStart <= endDate && schedEnd >= startDate
            }
            return false
        })

        return response.ok({
            schedules: relevantSchedules,
            startDate: startDate.toISO(),
            endDate: endDate.toISO(),
            view
        })
    }
}
