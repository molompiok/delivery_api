import { BaseCommand } from '@adonisjs/core/ace'
import User from '#models/user'
import Company from '#models/company'
import CompanyDriverSetting from '#models/company_driver_setting'

export default class CheckWallets extends BaseCommand {
    public static commandName = 'wallets:check'
    public static description = 'Vérifie l\'état des walletId dans la base'

    public static options = {
        startApp: true,
    }

    public async run() {
        this.logger.info('📊 État des wallets:\n')

        const userTotal = await User.query().count('* as total')
        const userWithWallet = await User.query().whereNotNull('walletId').count('* as total')
        this.logger.info(`👤 Users: ${userWithWallet[0].$extras.total} / ${userTotal[0].$extras.total} avec wallet`)

        const companyTotal = await Company.query().count('* as total')
        const companyWithWallet = await Company.query().whereNotNull('walletId').count('* as total')
        this.logger.info(`🏢 Companies: ${companyWithWallet[0].$extras.total} / ${companyTotal[0].$extras.total} avec wallet`)

        const cdsTotal = await CompanyDriverSetting.query().count('* as total')
        const cdsWithWallet = await CompanyDriverSetting.query().whereNotNull('walletId').count('* as total')
        this.logger.info(`🚗 CDS: ${cdsWithWallet[0].$extras.total} / ${cdsTotal[0].$extras.total} avec wallet`)
    }
}
