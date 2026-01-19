import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { createUserWithPhone, uploadFakeFile } from '../seeders/helpers/seeder_helper.js'
import DriverService from '#services/driver_service'

export default class DriversSeeder extends BaseSeeder {
    async run() {
        console.log('🚗 Seeding Drivers...')

        // ===== FastDelivery Drivers =====
        console.log('  FastDelivery Drivers:')

        // Driver 1: Fully active and verified
        const driver1Fast = await createUserWithPhone('+2250700000101', {
            email: 'driver1.fast@delivery.ci',
            fullName: 'Kofi Mensah',

        })
        if (!driver1Fast.isDriver) {
            await DriverService.register(driver1Fast, {
                vehicleType: 'Moto',
                vehiclePlate: 'AB-1234-CI',
            })
        }
        const driverSetting1 = await (await import('#models/driver_setting')).default.query().where('userId', driver1Fast.id).firstOrFail()
        driverSetting1.verificationStatus = 'VERIFIED'
        await driverSetting1.save()

        // Upload all required documents
        await uploadFakeFile('User', driver1Fast.id, 'Permis de conduire', { category: 'PDF' })
        await uploadFakeFile('User', driver1Fast.id, 'Carte d\'identité', { category: 'IMAGE' })
        await uploadFakeFile('User', driver1Fast.id, 'Carte grise', { category: 'PDF' })
        await uploadFakeFile('User', driver1Fast.id, 'Assurance véhicule', { category: 'PDF' })
        await uploadFakeFile('User', driver1Fast.id, 'Photo de profil', { category: 'IMAGE' })
        console.log('    ✅ Driver 1: Kofi Mensah (VERIFIED, 5 files)')

        // Driver 2: Accepted, pending verification
        const driver2Fast = await createUserWithPhone('+2250700000102', {
            email: 'driver2.fast@delivery.ci',
            fullName: 'Ama Asante',

        })
        if (!driver2Fast.isDriver) {
            await DriverService.register(driver2Fast, {
                vehicleType: 'Voiture',
                vehiclePlate: 'CD-5678-CI',
            })
        }
        // Upload documents
        await uploadFakeFile('User', driver2Fast.id, 'Permis de conduire', { category: 'PDF' })
        await uploadFakeFile('User', driver2Fast.id, 'Carte d\'identité', { category: 'IMAGE' })
        await uploadFakeFile('User', driver2Fast.id, 'Carte grise', { category: 'PDF' })
        await uploadFakeFile('User', driver2Fast.id, 'Assurance véhicule', { category: 'PDF' })
        console.log('    ✅ Driver 2: Ama Asante (PENDING verification, 4 files)')

        // Driver 3: Will be invited
        const driver3Fast = await createUserWithPhone('+2250700000103', {
            email: 'driver3.fast@delivery.ci',
            fullName: 'Kwame Nkrumah',

        })
        if (!driver3Fast.isDriver) {
            await DriverService.register(driver3Fast, {
                vehicleType: 'Moto',
                vehiclePlate: 'EF-9012-CI',
            })
        }
        await uploadFakeFile('User', driver3Fast.id, 'Permis de conduire', { category: 'PDF' })
        await uploadFakeFile('User', driver3Fast.id, 'Carte d\'identité', { category: 'IMAGE' })
        console.log('    ✅ Driver 3: Kwame Nkrumah (2 files)')

        // Driver 4: Documents uploaded, waiting validation
        const driver4Fast = await createUserWithPhone('+2250700000104', {
            email: 'driver4.fast@delivery.ci',
            fullName: 'Yaa Asantewaa',

        })
        if (!driver4Fast.isDriver) {
            await DriverService.register(driver4Fast, {
                vehicleType: 'Voiture',
                vehiclePlate: 'GH-3456-CI',
            })
        }
        await uploadFakeFile('User', driver4Fast.id, 'Permis de conduire', { category: 'PDF' })
        await uploadFakeFile('User', driver4Fast.id, 'Carte d\'identité', { category: 'IMAGE' })
        await uploadFakeFile('User', driver4Fast.id, 'Carte grise', { category: 'PDF' })
        console.log('    ✅ Driver 4: Yaa Asantewaa (3 files)')

        // Driver 5: Will reject document request
        const driver5Fast = await createUserWithPhone('+2250700000105', {
            email: 'driver5.fast@delivery.ci',
            fullName: 'Osei Tutu',

        })
        if (!driver5Fast.isDriver) {
            await DriverService.register(driver5Fast, {
                vehicleType: 'Moto',
                vehiclePlate: 'IJ-7890-CI',
            })
        }
        console.log('    ✅ Driver 5: Osei Tutu (no files)')

        // ===== SlowCargo Drivers =====
        console.log('  SlowCargo Drivers:')

        // Driver 1: Accepted
        const driver1Slow = await createUserWithPhone('+2250700000201', {
            email: 'driver1.slow@cargo.ci',
            fullName: 'Fatou Sow',

        })
        if (!driver1Slow.isDriver) {
            await DriverService.register(driver1Slow, {
                vehicleType: 'Camion',
                vehiclePlate: 'KL-1234-CI',
            })
        }
        await uploadFakeFile('User', driver1Slow.id, 'Permis de conduire', { category: 'PDF' })
        await uploadFakeFile('User', driver1Slow.id, 'Carte d\'identité', { category: 'IMAGE' })
        console.log('    ✅ Driver 1: Fatou Sow (2 files)')

        // Driver 2: Pending request
        const driver2Slow = await createUserWithPhone('+2250700000202', {
            email: 'driver2.slow@cargo.ci',
            fullName: 'Mamadou Ba',

        })
        if (!driver2Slow.isDriver) {
            await DriverService.register(driver2Slow, {
                vehicleType: 'Camion',
                vehiclePlate: 'MN-5678-CI',
            })
        }
        console.log('    ✅ Driver 2: Mamadou Ba (no files)')

        // ===== Independent Drivers =====
        console.log('  Independent Drivers:')

        // Solo 1: Verified, no company
        const solo1 = await createUserWithPhone('+2250700000301', {
            email: 'solo.driver1@gmail.com',
            fullName: 'Ibrahim Traoré',

        })
        if (!solo1.isDriver) {
            await DriverService.register(solo1, {
                vehicleType: 'Moto',
                vehiclePlate: 'OP-1111-CI',
            })
        }
        const soloSetting1 = await (await import('#models/driver_setting')).default.query().where('userId', solo1.id).firstOrFail()
        soloSetting1.verificationStatus = 'VERIFIED'
        await soloSetting1.save()
        await uploadFakeFile('User', solo1.id, 'Permis de conduire', { category: 'PDF' })
        await uploadFakeFile('User', solo1.id, 'Carte d\'identité', { category: 'IMAGE' })
        await uploadFakeFile('User', solo1.id, 'Carte grise', { category: 'PDF' })
        await uploadFakeFile('User', solo1.id, 'Assurance véhicule', { category: 'PDF' })
        console.log('    ✅ Solo 1: Ibrahim Traoré (VERIFIED, 4 files)')

        // Solo 2: Incomplete documents
        const solo2 = await createUserWithPhone('+2250700000302', {
            email: 'solo.driver2@gmail.com',
            fullName: 'Aissatou Diop',

        })
        if (!solo2.isDriver) {
            await DriverService.register(solo2, {
                vehicleType: 'Voiture',
                vehiclePlate: 'QR-2222-CI',
            })
        }
        await uploadFakeFile('User', solo2.id, 'Permis de conduire', { category: 'PDF' })
        console.log('    ✅ Solo 2: Aissatou Diop (1 file)')

        // Solo 3: Just registered
        const solo3 = await createUserWithPhone('+2250700000303', {
            email: 'solo.driver3@gmail.com',
            fullName: 'Sekou Touré',

        })
        if (!solo3.isDriver) {
            await DriverService.register(solo3, {
                vehicleType: 'Moto',
                vehiclePlate: 'ST-3333-CI',
            })
        }
        console.log('    ✅ Solo 3: Sekou Touré (no files)')

        console.log('✅ Drivers seeding completed\n')
    }
}
