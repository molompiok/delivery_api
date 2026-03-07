import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import User from '#models/user'
import Company from '#models/company'
import CompanyDriverSetting from '#models/company_driver_setting'
import WalletProvisioningService from '#services/wallet_provisioning_service'

export default class BackfillWallets extends BaseCommand {
  static commandName = 'wallet:backfill'
  static description = 'Backfill missing walletIds for users, companies and company-driver relations'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('Starting wallet backfill...')

    let usersBackfilled = 0
    let companiesBackfilled = 0
    let relationsBackfilled = 0

    const users = await User.query().whereNull('walletId')
    this.logger.info(`Users without wallet: ${users.length}`)
    for (const user of users) {
      const walletId = await WalletProvisioningService.ensureUserWallet(user)
      if (walletId) usersBackfilled++
    }

    const companies = await Company.query().whereNull('walletId')
    this.logger.info(`Companies without wallet: ${companies.length}`)
    for (const company of companies) {
      const walletId = await WalletProvisioningService.ensureCompanyWallet(company)
      if (walletId) companiesBackfilled++
    }

    const relations = await CompanyDriverSetting.query()
      .whereNull('walletId')
      .whereNotIn('status', ['REJECTED', 'REMOVED'])
      .preload('company')
      .preload('driver')

    this.logger.info(`Company-driver relations without wallet: ${relations.length}`)
    for (const relation of relations) {
      const walletId = await WalletProvisioningService.ensureCompanyDriverWallet(relation)
      if (walletId) relationsBackfilled++
    }

    this.logger.success(
      `Backfill completed. Users: ${usersBackfilled}/${users.length}, Companies: ${companiesBackfilled}/${companies.length}, Relations: ${relationsBackfilled}/${relations.length}`
    )
  }
}
