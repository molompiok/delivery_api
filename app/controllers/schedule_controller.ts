import type { HttpContext } from '@adonisjs/core/http'
import ScheduleService from '#services/schedule_service'
import { ScheduleOwnerType } from '#models/schedule'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'

@inject()
export default class ScheduleController {
    constructor(protected scheduleService: ScheduleService) { }

    private mapKeys(data: any) {
        if (!data || typeof data !== 'object') return data
        const mapped: any = {}
        for (const key of Object.keys(data)) {
            const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase())
            mapped[camelKey] = data[key]
        }
        return mapped
    }

    async index({ request, response, auth }: HttpContext) {
        try {
            const { ownerType, ownerId } = this.mapKeys(request.qs())
            const user = auth.user!
            if (!ownerType || !ownerId) return response.badRequest({ message: 'ownerType and ownerId are required' })

            const schedules = await this.scheduleService.listSchedules(user, ownerType, ownerId)
            return response.ok(schedules)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async show({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const schedule = await this.scheduleService.getScheduleDetails(user, params.id)
            return response.ok(schedule)
        } catch (error: any) {
            return response.notFound({ message: error.message })
        }
    }

    async store({ request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const rawData = request.all()
            const { assignedUserIds, ...data } = this.mapKeys(rawData)
            const schedule = await this.scheduleService.saveSchedule(user, data)

            const finalUserIds = assignedUserIds || data.userIds
            if (finalUserIds && Array.isArray(finalUserIds)) {
                await this.scheduleService.assignUsers(user, schedule.id, finalUserIds)
            }

            return response.created(schedule)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async update({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const rawData = request.all()
            const { assignedUserIds, ...data } = { ...this.mapKeys(rawData), id: params.id }
            const schedule = await this.scheduleService.saveSchedule(user, data)

            const finalUserIds = assignedUserIds || data.userIds
            if (finalUserIds && Array.isArray(finalUserIds)) {
                await this.scheduleService.assignUsers(user, params.id, finalUserIds)
            }

            return response.ok(schedule)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async destroy({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            await this.scheduleService.deleteSchedule(user, params.id)
            return response.noContent()
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async checkAvailability({ request, response, auth }: HttpContext) {
        try {
            const { ownerType, ownerId, date } = this.mapKeys(request.qs())
            const user = auth.user!
            if (!ownerType || !ownerId || !date) return response.badRequest({ message: 'Missing fields' })

            const dateTime = DateTime.fromISO(date)
            if (!dateTime.isValid) return response.badRequest({ message: 'Invalid date' })

            const effectiveSchedule = await this.scheduleService.getEffectiveSchedule(ownerType as ScheduleOwnerType, ownerId, dateTime)
            if (!await this.scheduleService.canViewSchedule(user, ownerType, ownerId, effectiveSchedule)) {
                return response.forbidden({ message: 'Access restricted' })
            }

            const isAvailable = await this.scheduleService.isAvailable(ownerType as ScheduleOwnerType, ownerId, dateTime)
            return response.ok({ isAvailable, effectiveSchedule })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async assignUsers({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const { userIds, assignedUserIds } = this.mapKeys(request.only(['userIds', 'user_ids', 'assignedUserIds', 'assigned_user_ids']))
            const finalUserIds = userIds || assignedUserIds
            await this.scheduleService.assignUsers(user, params.id, finalUserIds)
            return response.ok({ message: 'Users assigned successfully' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async unassignUsers({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const { userIds, assignedUserIds } = this.mapKeys(request.only(['userIds', 'user_ids', 'assignedUserIds', 'assigned_user_ids']))
            const finalUserIds = userIds || assignedUserIds
            await this.scheduleService.unassignUsers(user, params.id, finalUserIds)
            return response.ok({ message: 'Users unassigned successfully' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async getAssignedUsers({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const users = await this.scheduleService.getAssignedUsers(user, params.id)
            return response.ok(users)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    async getCalendarView({ request, response, auth }: HttpContext) {
        try {
            const { view, date, ownerId, ownerType } = this.mapKeys(request.qs())
            const user = auth.user!
            const result = await this.scheduleService.getCalendarView(user, { view, date, ownerId, ownerType })
            return response.ok(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
