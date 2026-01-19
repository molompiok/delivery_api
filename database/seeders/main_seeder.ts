import { BaseSeeder } from '@adonisjs/lucid/seeders'

export default class IndexSeeder extends BaseSeeder {
    private async seed(Seeder: { default: typeof BaseSeeder }) {
        await new Seeder.default(this.client).run()
    }

    async run() {
        console.log('\n🌱 Starting Database Seeding...\n')
        console.log('='.repeat(50))

        // 0. Sublymus global data (zones, etc.) - FIRST
        await this.seed(await import('#database/data_seeders/0_sublymus_seeder'))

        // 1. Platform setup
        await this.seed(await import('#database/data_seeders/admin_seeder'))
        await this.seed(await import('#database/data_seeders/2_companies_seeder'))

        // 2. Users and drivers
        await this.seed(await import('#database/data_seeders/3_drivers_seeder'))

        // 3. Zones (company & driver zones, not Sublymus)
        await this.seed(await import('#database/data_seeders/3_zones_seeder'))

        // 4. Invitations and dashboard data
        await this.seed(await import('#database/data_seeders/4_invitations_seeder'))
        await this.seed(await import('#database/data_seeders/5_dashboard_seeder'))

        console.log('='.repeat(50))
        console.log('\n✅ Database seeding completed successfully!\n')
        console.log('📊 Summary:')
        console.log('  - 10 Sublymus zones (global)')
        console.log('  - 2 Admins')
        console.log('  - 2 Companies (1 verified, 1 pending)')
        console.log('  - 8 Drivers (various statuses)')
        console.log('  - 7+ Company/Driver zones')
        console.log('  - 7 Document Requests (various states)')
        console.log('  - 4 Invitations (various stages)')
        console.log('  - ~50+ Files uploaded')
        console.log('\n')
    }
}

