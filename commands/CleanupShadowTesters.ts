import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import User from '#models/user'

export default class CleanupShadowTesters extends BaseCommand {
    static commandName = 'cleanup:shadow-testers'
    static description = 'Delete all users named "Shadow Tester" and their associated settings'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('Starting cleanup of "Shadow Tester" users...')

        try {
            // Find users with the specific name
            const users = await User.query().where('fullName', 'Shadow Tester')

            if (users.length === 0) {
                this.logger.info('No users found with name "Shadow Tester".')
                return
            }

            this.logger.info(`Found ${users.length} user(s) to delete.`)

            for (const user of users) {
                this.logger.info(`Deleting user: ${user.id} (${user.email || 'no email'})`)

                // Note: Database foreign keys with ON DELETE CASCADE will handle:
                // - driver_settings (user_id)
                // - company_driver_settings (driver_id)
                // - schedule_assignments (user_id)
                // etc.

                await user.delete()
                this.logger.success(`  User ${user.id} deleted.`)
            }

            this.logger.success(`Cleanup completed. ${users.length} users removed.`)
        } catch (error: any) {
            this.logger.error(`Cleanup failed: ${error.message}`)
            throw error
        }
    }
}
