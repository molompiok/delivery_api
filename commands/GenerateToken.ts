import { BaseCommand, flags } from '@adonisjs/core/ace'

export default class GenerateToken extends BaseCommand {
    static commandName = 'generate:token'
    static description = 'Generate a Bearer token for a user by phone number'

    @flags.string({ description: 'Phone number of the user (e.g. "+2250700000101")' })
    declare phone: string

    async run() {
        await this.app.boot()

        if (!this.phone) {
            this.logger.error('❌ --phone flag is required. Example: node ace generate:token --phone "+2250700000101"')
            return
        }

        const User = (await import('#models/user')).default

        const user = await User.findBy('phone', this.phone)
        if (!user) {
            this.logger.error(`❌ No user found with phone: ${this.phone}`)
            return
        }

        const token = await User.accessTokens.create(user)
        const tokenValue = token.value!.release()

        this.logger.info('─'.repeat(60))
        this.logger.info(`✅ Token generated for: ${user.fullName || user.phone}`)
        this.logger.info(`   User ID:   ${user.id}`)
        this.logger.info(`   Phone:     ${user.phone}`)
        this.logger.info('─'.repeat(60))
        this.logger.info(`🔑 TOKEN: ${tokenValue}`)
        this.logger.info('─'.repeat(60))
    }
}
