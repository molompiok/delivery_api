import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'
import { DateTime } from 'luxon'

export default class extends BaseSeeder {
    async run() {
        // Define admin users
        const admins = [
            { phone: '+2250759929515', fullName: 'Opus' },
            { phone: '+2250759091098', fullName: 'Messah' },
        ]

        for (const adminData of admins) {
            // Find or create user
            const user = await User.firstOrCreate(
                { phone: adminData.phone },
                {
                    phone: adminData.phone,
                    fullName: adminData.fullName,
                    isAdmin: true,
                    isActive: true,
                    phoneVerifiedAt: DateTime.now(),
                }
            )

            // Ensure they are admin
            if (!user.isAdmin) {
                user.isAdmin = true
                await user.save()
            }

            console.log(`✅ Admin user created/updated: ${adminData.fullName} (${adminData.phone})`)
        }
    }
}
