import { BaseCommand } from '@adonisjs/core/ace'

export default class TestImport extends BaseCommand {
    static commandName = 'test:import'
    static description = 'Test model import'

    async run() {
        this.logger.info('Testing import...')
        try {
            const { default: User } = await import('../app/models/user.js')
            this.logger.info(`User imported: ${User ? 'YES' : 'NO'}`)
            if (User) {
                this.logger.info(`User name: ${User.name}`)
                this.logger.info(`Has query: ${typeof User.query === 'function' ? 'YES' : 'NO'}`)

                const count = await User.query().count('* as total')
                this.logger.info(`User count: ${JSON.stringify(count)}`)
            }
        } catch (error) {
            this.logger.error(`Import failed: ${error.message}`)
            console.error(error)
        }
    }
}
