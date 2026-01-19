import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Company from '#models/company'
import { createUserWithPhone } from '../seeders/helpers/seeder_helper.js'

export default class CompaniesSeeder extends BaseSeeder {
    async run() {
        console.log('🏢 Seeding Companies...')

        // Owner 1
        const owner1 = await createUserWithPhone('+2250101010101', {
            fullName: 'Manager FastDelivery',
            email: 'manager@fastdelivery.ci'
        })

        const company1 = await Company.updateOrCreate(
            { name: 'FastDelivery CI' },
            {
                name: 'FastDelivery CI',
                ownerId: owner1.id,
                registreCommerce: 'RC-ABJ-2024-B-1234',
                description: 'Livraison express à Abidjan et périphérie.',
                verificationStatus: 'VERIFIED'
            }
        )
        owner1.companyId = company1.id
        owner1.currentCompanyManaged = company1.id
        await owner1.save()
        console.log('  ✅ Created Company: FastDelivery CI')

        // Owner 2
        const owner2 = await createUserWithPhone('+2250202020202', {
            fullName: 'Manager SlowCargo',
            email: 'manager@slowcargo.ci'
        })

        const company2 = await Company.updateOrCreate(
            { name: 'SlowCargo' },
            {
                name: 'SlowCargo',
                ownerId: owner2.id,
                registreCommerce: 'RC-ABJ-2024-B-5678',
                description: 'Transport de marchandises lourdes.',
                verificationStatus: 'PENDING'
            }
        )
        owner2.companyId = company2.id
        owner2.currentCompanyManaged = company2.id
        await owner2.save()
        console.log('  ✅ Created Company: SlowCargo')

        console.log('✅ Companies seeding completed\n')
    }
}
