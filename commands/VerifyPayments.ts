import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import User from '#models/user'
import DriverPaymentsController from '#controllers/driver_payments_controller'

export default class VerifyPayments extends BaseCommand {
    static commandName = 'verify:payments'
    static description = 'Verify driver payments flow'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const user = await User.query().where('phone', '+2250759929515').firstOrFail()
        this.logger.info(`Testing with user: ${user.fullName} (${user.id})`)

        const controller = await this.app.container.make(DriverPaymentsController)

        // Mock HttpContext
        const mockCtx = (body: any = {}, qs: any = {}) => ({
            auth: { user },
            request: {
                body: () => body,
                qs: () => qs
            },
            response: {
                ok: (data: any) => { this.logger.success('✅ OK: ' + JSON.stringify(data, null, 2)); return data },
                badRequest: (data: any) => { this.logger.error('❌ BadRequest: ' + JSON.stringify(data, null, 2)); return data },
                forbidden: (data: any) => { this.logger.error('🚫 Forbidden: ' + JSON.stringify(data, null, 2)); return data },
                created: (data: any) => { this.logger.success('✨ Created: ' + JSON.stringify(data, null, 2)); return data }
            }
        } as any)

        this.logger.info('\n--- 1. Testing listWallets ---')
        await controller.listWallets(mockCtx())

        this.logger.info('\n--- 2. Testing getTransactions (Ledgers) ---')
        await controller.getTransactions(mockCtx({}, { wallet_id: user.walletId, limit: 5 }))

        this.logger.info('\n--- 3. Testing stats ---')
        await controller.stats(mockCtx({}, { walletId: user.walletId }))

        this.logger.info('\n--- 4. Testing deposit (link) ---')
        await controller.deposit(mockCtx({
            walletId: user.walletId,
            amount: 100,
            description: 'Test Deposit Gemini'
        }))

        this.logger.info('\n--- 5. Testing payout (withdrawal) - 30F ---')
        await controller.payout(mockCtx({
            walletId: user.walletId,
            amount: 30,
            recipientPhone: '+2250759929515'
        }))
    }
}
