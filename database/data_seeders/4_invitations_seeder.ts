import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Company from '#models/company'
import User from '#models/user'
import CompanyService from '#services/company_service'
import DriverService from '#services/driver_service'

export default class InvitationsSeeder extends BaseSeeder {
    async run() {
        console.log('✉️ Seeding Invitations and Document Requests...')

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
            const relation = await CompanyService.inviteDriver(managerFast!, kofi.phone!)
            if (relation.status !== 'ACCEPTED') {
                relation.status = 'ACCEPTED'
                relation.acceptedAt = (await import('luxon')).DateTime.now()
                await relation.save()
            }
            console.log('  ✅ Invited & Accepted: Kofi Mensah (FastDelivery)')
        }

        // 2. Ama Asante (Driver 2) - Pending access
        const ama = await User.findBy('phone', '+2250700000102')
        if (ama) {
            await CompanyService.inviteDriver(managerFast!, ama.phone!)
            console.log('  ✅ Invitation PENDING_ACCESS: Ama Asante (FastDelivery)')
        }

        // 3. Kwame Nkrumah (Driver 3) - Access Accepted, waiting for docs selection
        const kwame = await User.findBy('phone', '+2250700000103')
        if (kwame) {
            const rel = await CompanyService.inviteDriver(managerFast!, kwame.phone!)

            // Mirror docs if still pending access
            if (rel.status === 'PENDING_ACCESS') {
                await DriverService.acceptAccessRequest(kwame, rel.id)
            }

            // Set required docs
            await CompanyService.setRequiredDocs(managerFast!, kwame.id, ['dct_licence', 'dct_identity'])
            console.log('  ✅ Invitation ACCESS_ACCEPTED & Required Docs Set: Kwame Nkrumah (FastDelivery)')
        }

        // 4. Yaa Asantewaa (Driver 4) - Documents pending validation
        const yaa = await User.findBy('phone', '+2250700000104')
        if (yaa) {
            const rel = await CompanyService.inviteDriver(managerFast!, yaa.phone!)

            if (rel.status === 'PENDING_ACCESS') {
                await DriverService.acceptAccessRequest(yaa, rel.id)
            }
            await CompanyService.setRequiredDocs(managerFast!, yaa.id, ['dct_licence', 'dct_identity', 'dct_vehicle_card'])
            console.log('  ✅ Invitation with Pending Docs: Yaa Asantewaa (FastDelivery)')
        }

        console.log('✅ Invitations seeding completed\n')
    }
}
