import User from '#models/user'
import CompanyDriverSetting from '#models/company_driver_setting'

async function run() {
    const drivers = await User.query().where('isDriver', true)
    console.log(`Found ${drivers.length} drivers:`)
    for (const driver of drivers) {
        console.log(`- Driver: ${driver.fullName} (${driver.id}), Phone: ${driver.phone}, WalletId: ${driver.walletId}`)

        const relations = await CompanyDriverSetting.query()
            .where('driverId', driver.id)
            .whereIn('status', ['ACCEPTED', 'ACCESS_ACCEPTED'])
            .preload('company')

        for (const rel of relations) {
            console.log(`  - Relation with ${rel.company.name} (${rel.id}), WalletId: ${rel.walletId}, Status: ${rel.status}`)
        }
    }
}

run().catch(console.error).finally(() => process.exit())
