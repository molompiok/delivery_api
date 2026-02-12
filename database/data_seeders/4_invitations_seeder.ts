import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Company from '#models/company'
import User from '#models/user'
import app from '@adonisjs/core/services/app'
import CompanyService from '#services/company_service'
import DriverService from '#services/driver_service'

export default class InvitationsSeeder extends BaseSeeder {
    async run() {
        console.log('✉️ Seeding Invitations and Document Requests...')

        const companyService = await app.container.make(CompanyService)
        const driverService = await app.container.make(DriverService)

        const fastDelivery = await Company.findBy('name', 'FastDelivery CI')
        const slowCargo = await Company.findBy('name', 'SlowCargo')

        if (!fastDelivery || !slowCargo) {
            console.error('❌ Companies not found, skipping invitations')
            return
        }

        const managerFast = await User.findBy('email', 'manager@fastdelivery.ci')

        // 1. Kofi Mensah (Driver 1) - Already in company
        const kofi = await User.findBy('phone', '+2250700000101')
        if (kofi) {
            const relation = await companyService.inviteDriver(managerFast!, kofi.phone!)
            if (relation.status !== 'ACCEPTED') {
                relation.status = 'ACCEPTED'
                relation.acceptedAt = (await import('luxon')).DateTime.now()
                await relation.save()

                // Crucial: Update the driver's current company setting so they see missions
                const DriverSetting = (await import('#models/driver_setting')).default
                await DriverSetting.updateOrCreate(
                    { userId: kofi.id },
                    { currentCompanyId: relation.companyId }
                )
            }
            console.log('  ✅ Invited & Accepted: Kofi Mensah (FastDelivery)')
        }

        // 2. Ama Asante (Driver 2) - Pending access
        const ama = await User.findBy('phone', '+2250700000102')
        if (ama) {
            await companyService.inviteDriver(managerFast!, ama.phone!)
            console.log('  ✅ Invitation PENDING_ACCESS: Ama Asante (FastDelivery)')
        }

        // 3. Kwame Nkrumah (Driver 3) - Access Accepted, waiting for docs selection
        const kwame = await User.findBy('phone', '+2250700000103')
        if (kwame) {
            const rel = await companyService.inviteDriver(managerFast!, kwame.phone!)

            if (rel.status === 'PENDING_ACCESS') {
                await driverService.acceptAccessRequest(kwame, rel.id)
            }

            await companyService.setRequiredDocs(managerFast!, kwame.id, ['dct_licence', 'dct_identity'])
            console.log('  ✅ Invitation ACCESS_ACCEPTED & Required Docs Set: Kwame Nkrumah (FastDelivery)')
        }

        // 4. Yaa Asantewaa (Driver 4) - Documents pending validation
        const yaa = await User.findBy('phone', '+2250700000104')
        if (yaa) {
            const rel = await companyService.inviteDriver(managerFast!, yaa.phone!)

            if (rel.status === 'PENDING_ACCESS') {
                await driverService.acceptAccessRequest(yaa, rel.id)
            }
            await companyService.setRequiredDocs(managerFast!, yaa.id, ['dct_licence', 'dct_identity', 'dct_vehicle_card'])
            console.log('  ✅ Invitation with Pending Docs: Yaa Asantewaa (FastDelivery)')
        }

        console.log('✅ Invitations seeding completed\n')
    }
}
