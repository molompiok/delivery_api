import walletBridgeService from '#services/wallet_bridge_service'
import User from '#models/user'

async function run() {
    const driver = await User.query().where('isDriver', true).whereNotNull('walletId').first()
    if (!driver) {
        console.log('No driver with walletId found')
        return
    }

    console.log(`Testing with driver: ${driver.fullName}, walletId: ${driver.walletId}`)
    try {
        const wallet = await walletBridgeService.getWallet(driver.walletId!)
        console.log('Wallet data:', JSON.stringify(wallet, null, 2))
    } catch (error: any) {
        console.error('Error fetching wallet:', error.message)
        if (error.stack) console.error(error.stack)
    }
}

run().catch(console.error).finally(() => process.exit())
