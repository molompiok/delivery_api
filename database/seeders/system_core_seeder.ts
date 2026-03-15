import { BaseSeeder } from '@adonisjs/lucid/seeders'

export default class SystemCoreSeeder extends BaseSeeder {
    private async seed(Seeder: { default: typeof BaseSeeder }) {
        await new Seeder.default(this.client).run()
    }

    async run() {
        console.log('\n🚀 Starting System Core Seeding (Essential Data)...\n')
        console.log('='.repeat(50))

        // 1. Zones Globales (Sublymus)
        await this.seed(await import('#database/data_seeders/0_sublymus_seeder'))

        // 2. Administrators
        await this.seed(await import('#database/data_seeders/admin_seeder'))

        // 3. Subscription Plans
        await this.seed(await import('#database/data_seeders/1_subscription_plans_seeder'))

        console.log('='.repeat(50))
        console.log('\n✅ System Core seeding completed successfully!\n')
    }
}
