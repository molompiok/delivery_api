import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Company from '#models/company'
import User from '#models/user'
import Vehicle from '#models/vehicle'
import Schedule, { RecurrenceType, ScheduleCategory, ScheduleType } from '#models/schedule'

export default class DashboardSeeder extends BaseSeeder {
    async run() {
        console.log('📊 Seeding Dashboard Data (Vehicles, Schedules, Orders)...')

        const fastDelivery = await Company.findBy('name', 'FastDelivery CI')
        if (!fastDelivery) return

        const drivers = await User.query().where('isDriver', true).limit(5)

        // 1. Vehicles
        console.log('  🚚 Seeding Vehicles...')
        const vehicleData = [
            { type: 'MOTO', brand: 'Yamaha', model: 'Crux', plate: 'AB-1234-CI', color: 'Blue', energy: 'GASOLINE' },
            { type: 'MOTO', brand: 'KTM', model: 'Duke', plate: 'CD-5678-CI', color: 'Orange', energy: 'GASOLINE' },
            { type: 'CAR_SEDAN', brand: 'Toyota', model: 'Corolla', plate: 'EF-9012-CI', color: 'White', energy: 'HYBRID' },
            { type: 'VAN', brand: 'Mercedes', model: 'Sprinter', plate: 'GH-3456-CI', color: 'White', energy: 'DIESEL' },
        ]

        for (let i = 0; i < vehicleData.length; i++) {
            await Vehicle.updateOrCreate(
                { plate: vehicleData[i].plate },
                {
                    type: vehicleData[i].type as any,
                    brand: vehicleData[i].brand,
                    model: vehicleData[i].model,
                    plate: vehicleData[i].plate,
                    energy: vehicleData[i].energy as any,
                    color: vehicleData[i].color,
                    ownerType: 'Company',
                    ownerId: fastDelivery.id,
                    companyId: fastDelivery.id,
                    assignedDriverId: drivers[i]?.id || null,
                    verificationStatus: 'APPROVED' as any,
                }
            )
        }

        // 2. Schedules
        console.log('  📅 Seeding Schedules...')
        const scheduleLabels = ['Shift Matin', 'Shift Après-midi', 'Garde Nuit', 'Weekend Full']
        for (let i = 0; i < 4; i++) {
            const sch = await Schedule.updateOrCreate(
                { label: scheduleLabels[i], ownerId: fastDelivery.id },
                {
                    label: scheduleLabels[i],
                    ownerType: 'Company',
                    ownerId: fastDelivery.id,
                    scheduleType: ScheduleType.WORK,
                    scheduleCategory: ScheduleCategory.WORK,
                    recurrenceType: RecurrenceType.WEEKLY,
                    dayOfWeek: (i + 1) % 7, // Lun, Mar, Mer, Jeu
                    startTime: '08:00',
                    endTime: '17:00',
                    isActive: true,
                    color: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'][i]
                }
            )
            // Assign some drivers
            if (drivers.length > 0) {
                await sch.related('assignedUsers').sync([drivers[i % drivers.length].id])
            }
        }

        // 3. Addresses & Orders (Bypassed due to refactoring)
        console.log('  📦 Seeding Orders (Bypassed due to refactoring)...')
        /*
        for (let i = 0; i < 5; i++) {
            // ... (legacy order creation)
        }
        */

        console.log('✅ Dashboard data seeding completed\n')
    }
}
