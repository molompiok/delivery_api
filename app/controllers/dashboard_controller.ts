import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import Order from '#models/order'
import Vehicle from '#models/vehicle'
import CompanyDriverSetting from '#models/company_driver_setting'
import { DateTime } from 'luxon'

@inject()
export default class DashboardController {
    /**
     * Get consolidated stats for the company dashboard
     */
    async getStats({ auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const companyId = user.companyId
            if (!companyId) {
                return response.badRequest({ message: 'User is not associated with a company' })
            }

            // 1. Mission Recap (Completed vs Total)
            // Total = everything not DELETED or CANCELLED
            // Completed = DELIVERED or COMPLETED
            const [totalMissions, completedMissions] = await Promise.all([
                Order.query()
                    .where('clientId', companyId)
                    .where('isDeleted', false)
                    .whereNot('status', 'CANCELLED')
                    .count('* as total'),
                Order.query()
                    .where('clientId', companyId)
                    .where('isDeleted', false)
                    .whereIn('status', ['DELIVERED', 'COMPLETED'])
                    .count('* as total')
            ])

            // 2. Weekly Activity (Missions per day for last 7 days)
            const weeklyActivity = []
            const now = DateTime.local()
            for (let i = 6; i >= 0; i--) {
                const date = now.minus({ days: i })
                const startOfDay = date.startOf('day').toSQL()
                const endOfDay = date.endOf('day').toSQL()

                const count = await Order.query()
                    .where('clientId', companyId)
                    .where('isDeleted', false)
                    .whereBetween('createdAt', [startOfDay!, endOfDay!])
                    .count('* as total')

                weeklyActivity.push({
                    date: date.toFormat('dd/MM'),
                    dayName: date.toFormat('ccc'),
                    count: Number(count[0].$extras.total || 0)
                })
            }

            // 3. Resource Counts
            const [vehiclesCount, driversCount] = await Promise.all([
                Vehicle.query().where('companyId', companyId).where('isDeleted', false).count('* as total'),
                CompanyDriverSetting.query().where('companyId', companyId).count('* as total')
            ])

            // 4. Missions Today
            const todayStart = now.startOf('day').toSQL()
            const todayEnd = now.endOf('day').toSQL()
            const missionsToday = await Order.query()
                .where('clientId', companyId)
                .where('isDeleted', false)
                .whereBetween('createdAt', [todayStart!, todayEnd!])
                .count('* as total')

            return response.ok({
                missions: {
                    total: Number(totalMissions[0].$extras.total || 0),
                    completed: Number(completedMissions[0].$extras.total || 0),
                    today: Number(missionsToday[0].$extras.total || 0)
                },
                weeklyActivity,
                resources: {
                    vehicles: Number(vehiclesCount[0].$extras.total || 0),
                    drivers: Number(driversCount[0].$extras.total || 0)
                }
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
