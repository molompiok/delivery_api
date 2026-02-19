import { Ignitor } from '@adonisjs/core'
import User from '#models/user'
import DriverPaymentsController from '#controllers/driver_payments_controller'

const APP_ROOT = new URL('../', import.meta.url)

async function run() {
    const ignitor = new Ignitor(APP_ROOT, {
        importer: (filePath) => import(filePath),
    })

    const app = ignitor.createApp('console')
    await app.init()
    await app.boot()

    const user = await User.query().where('phone', '+2250759929515').firstOrFail()
    console.log(`Testing with user: ${user.fullName} (${user.id})`)

    const controller = await app.container.make(DriverPaymentsController)

    // Mock HttpContext
    const mockCtx = (body: any = {}, qs: any = {}) => ({
        auth: { user },
        request: {
            body: () => body,
            qs: () => qs
        },
        response: {
            ok: (data: any) => { console.log('✅ OK:', JSON.stringify(data, null, 2)); return data },
            badRequest: (data: any) => { console.error('❌ BadRequest:', data); return data },
            forbidden: (data: any) => { console.error('🚫 Forbidden:', data); return data },
            created: (data: any) => { console.log('✨ Created:', JSON.stringify(data, null, 2)); return data }
        }
    } as any)

    console.log('\n--- 1. Testing listWallets ---')
    await controller.listWallets(mockCtx())

    console.log('\n--- 2. Testing getTransactions (Ledgers) ---')
    await controller.getTransactions(mockCtx({}, { wallet_id: user.walletId, limit: 5 }))

    console.log('\n--- 3. Testing stats ---')
    await controller.stats(mockCtx({}, { walletId: user.walletId }))

    console.log('\n--- 4. Testing deposit (link) ---')
    await controller.deposit(mockCtx({
        walletId: user.walletId,
        amount: 100,
        description: 'Test Deposit Gemini'
    }))

    console.log('\n--- 5. Testing payout (withdrawal) - 30F ---')
    await controller.payout(mockCtx({
        walletId: user.walletId,
        amount: 30,
        recipientPhone: '+2250759929515'
    }))

    await app.terminate()
}

run().catch(console.error)
