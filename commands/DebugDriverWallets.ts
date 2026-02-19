import { BaseCommand, args } from '@adonisjs/core/ace'
import User from '#models/user'
import CompanyDriverSetting from '#models/company_driver_setting'
import walletBridgeService from '#services/wallet_bridge_service'

export default class DebugDriverWallets extends BaseCommand {
    public static commandName = 'debug:driver-wallets'
    public static description = 'Debug driver wallets and their existence in wave-api'

    @args.string({ description: 'Phone number of the driver', required: false })
    declare phone: string

    public static options = {
        startApp: true,
    }

    public async run() {
        this.logger.info('🔍 Debugging Driver Wallets...')

        const query = User.query().where('isDriver', true)
        if (this.phone) {
            query.where('phone', this.phone)
        }
        const drivers = await query

        this.logger.info(`Found ${drivers.length} drivers.`)

        for (const driver of drivers) {
            this.logger.info(`\n👤 Driver: ${driver.fullName} (ID: ${driver.id})`)
            this.logger.info(`   - Phone: ${driver.phone}`)
            this.logger.info(`   - Local walletId: ${driver.walletId}`)

            if (driver.walletId) {
                try {
                    const wallet = await walletBridgeService.getWallet(driver.walletId)
                    const balance = (wallet as any).balance_available ?? (wallet as any).balanceAvailable
                    this.logger.success(`   - Wave-API Wallet: Found (Balance: ${balance} ${wallet.currency})`)
                } catch (e: any) {
                    this.logger.error(`   - Wave-API Wallet: NOT FOUND or ERROR (${e.message})`)
                    if (e.stack) console.error(e.stack)
                }
            } else {
                this.logger.warn(`   - No walletId assigned to user`)
            }

            const relations = await CompanyDriverSetting.query()
                .where('driverId', driver.id)
                .whereIn('status', ['ACCEPTED', 'ACCESS_ACCEPTED'])
                .preload('company')

            if (relations.length > 0) {
                this.logger.info(`   - Relations (${relations.length}):`)
                for (const rel of relations) {
                    this.logger.info(`     🏢 ${rel.company.name} (Status: ${rel.status}, WalletId: ${rel.walletId})`)
                    if (rel.walletId) {
                        try {
                            const wallet = await walletBridgeService.getWallet(rel.walletId)
                            const balance = (wallet as any).balance_available ?? (wallet as any).balanceAvailable
                            this.logger.success(`       - Wave-API Wallet: Found (Balance: ${balance} ${wallet.currency})`)
                        } catch (e: any) {
                            this.logger.error(`       - Wave-API Wallet: NOT FOUND or ERROR (${e.message})`)
                        }
                    }
                }
            } else {
                this.logger.info(`   - No active company relations.`)
            }
        }
    }
}
