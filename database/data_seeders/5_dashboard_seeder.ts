import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Company from '#models/company'
import User from '#models/user'
import Vehicle from '#models/vehicle'
import Schedule, { RecurrenceType, ScheduleCategory, ScheduleType } from '#models/schedule'
import Order from '#models/order'
import Address from '#models/address'

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
                    isActive: true,
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

        // 3. Addresses & Orders (Basic Mock)
        console.log('  📦 Seeding Orders...')
        for (let i = 0; i < 5; i++) {
            const pickup = await Address.create({
                label: `Pickup ${i}`,
                street: 'Boulevard Latrille',
                city: 'Abidjan',
                formattedAddress: `Boulevard Latrille, Abidjan ${i}`,
                lat: 5.35 + (Math.random() - 0.5) * 0.05,
                lng: -3.98 + (Math.random() - 0.5) * 0.05,
                ownerType: 'Company',
                ownerId: fastDelivery.id
            })

            const delivery = await Address.create({
                label: `Delivery ${i}`,
                street: 'Rue des Jardins',
                city: 'Abidjan',
                formattedAddress: `Rue des Jardins, Abidjan ${i}`,
                lat: 5.35 + (Math.random() - 0.5) * 0.05,
                lng: -3.98 + (Math.random() - 0.5) * 0.05,
                ownerType: 'User',
                ownerId: drivers[i % drivers.length].id
            })

            await Order.create({
                clientId: drivers[i % drivers.length].id,
                pickupAddressId: pickup.id,
                deliveryAddressId: delivery.id,
                status: (['PENDING', 'ACCEPTED', 'AT_PICKUP', 'COLLECTED', 'AT_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED'][i % 8]) as any,
                totalDistanceMeters: 5500,
                totalDurationSeconds: 900,
                driverId: i % 2 === 0 ? drivers[i % drivers.length].id : null
            })
        }

        console.log('✅ Dashboard data seeding completed\n')
    }
}
