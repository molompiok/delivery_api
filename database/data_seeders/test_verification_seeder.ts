import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'

export default class extends BaseSeeder {
    async run() {
        // 1. Create/Update Admin
        await User.updateOrCreate(
            { phone: '+2250700000001' },
            {
                fullName: 'Admin Test',
                isAdmin: true,
                isActive: true,
                phoneVerifiedAt: null // Explicitly null if needed, or set to now
            }
        )

        // 2. Create/Update Driver
        const driver = await User.updateOrCreate(
            { phone: '+2250700000111' },
            {
                fullName: 'Driver Test',
                isDriver: true,
                isActive: true
            }
        )

        // Ensure DriverSetting exists
        const DriverSetting = (await import('#models/driver_setting')).default
        await DriverSetting.updateOrCreate(
            { userId: driver.id },
            {
                vehicleType: 'Car',
                vehiclePlate: 'TEST-123'
            }
        )
        // 3. Create/Update Company Owner
        await User.updateOrCreate(
            { phone: '+2250700000222' },
            {
                fullName: 'Company Owner Test',
                isActive: true
            }
        )

        console.log('Test Seeder Ran: Admin (+2250700000001), Driver (+2250700000111), Owner (+2250700000222)')
    }
}
