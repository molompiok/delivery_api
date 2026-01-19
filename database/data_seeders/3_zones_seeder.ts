import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Zone from '#models/zone'
import User from '#models/user'
import Company from '#models/company'
import CompanyDriverSetting from '#models/company_driver_setting'

export default class ZonesSeeder extends BaseSeeder {
    async run() {
        console.log('🌍 Seeding Zones and Driver Statuses...')

        const fastDelivery = await Company.findBy('name', 'FastDelivery CI')
        if (!fastDelivery) return

        // 1. Create Company-owned Zones
        const zonesData = [
            { id: 'Z1', name: 'Cocody Centre', color: '#10b981', sector: 'ABIDJAN', type: 'circle' as const, geometry: { radiusKm: 4, center: { lat: 5.359, lng: -3.984 } }, isActive: true },
            { id: 'Z2', name: 'Plateau Business', color: '#3b82f6', sector: 'ABIDJAN', type: 'circle' as const, geometry: { radiusKm: 2, center: { lat: 5.321, lng: -4.018 } }, isActive: true },
            { id: 'Z3', name: 'Marcory Zone 4', color: '#f59e0b', sector: 'ABIDJAN', type: 'circle' as const, geometry: { radiusKm: 3, center: { lat: 5.303, lng: -3.996 } }, isActive: true },
            { id: 'Z4', name: 'Yopougon Ind.', color: '#ef4444', sector: 'ABIDJAN', type: 'circle' as const, geometry: { radiusKm: 6, center: { lat: 5.341, lng: -4.084 } }, isActive: true },
            { id: 'Z5', name: 'Yamoussoukro Centre', color: '#f59e0b', sector: 'YAMOUSSOUKRO', type: 'rectangle' as const, geometry: { bounds: { north: 6.825, south: 6.812, east: -5.265, west: -5.285 } }, isActive: true },
            { id: 'Z6', name: 'Le Plateau (Polygone)', color: '#3b82f6', sector: 'ABIDJAN', type: 'polygon' as const, geometry: { paths: [{ lat: 5.334, lng: -4.015 }, { lat: 5.328, lng: -4.004 }, { lat: 5.313, lng: -4.009 }, { lat: 5.316, lng: -4.027 }, { lat: 5.327, lng: -4.024 }] }, isActive: true },
            { id: 'Z7', name: 'Aéroport / Port', color: '#ec4899', sector: 'ABIDJAN', type: 'circle' as const, geometry: { radiusKm: 3, center: { lat: 5.261, lng: -3.926 } }, isActive: false },
        ]

        for (const data of zonesData) {
            await Zone.updateOrCreate(
                { id: data.id },
                {
                    ...data,
                    ownerType: 'Company',
                    ownerId: fastDelivery.id,
                }
            )
        }
        console.log('  ✅ Created company zones')

        // NOTE: Sublymus zones are created in 0_sublymus_seeder.ts

        // 2. Add driver-owned zones (IDEP)
        const drivers = await User.query().where('isDriver', true).preload('driverSetting')
        if (drivers.length > 0) {
            const driverZone = await Zone.updateOrCreate(
                { name: 'Zone Perso Jean', ownerId: drivers[0].id },
                {
                    name: 'Zone Perso Jean',
                    color: '#8b5cf6',
                    sector: 'ABIDJAN',
                    type: 'circle',
                    geometry: { center: { lat: 5.309, lng: -4.019 }, radiusKm: 2.5 },
                    ownerType: 'User',
                    ownerId: drivers[0].id,
                    isActive: true
                }
            )

            // Set as active zone for IDEP mode
            if (drivers[0].driverSetting) {
                drivers[0].driverSetting.activeZoneId = driverZone.id
                await drivers[0].driverSetting.save()
            }
            console.log('  ✅ Created driver-owned zones')
        }

        // 4. Update Driver Profiles with Status and Location
        const driversList = await User.query().where('isDriver', true).preload('driverSetting')

        const statuses: ('ONLINE' | 'BUSY' | 'PAUSE')[] = ['ONLINE', 'BUSY', 'PAUSE']
        const centerAbidjan = { lat: 5.348, lng: -4.012 }

        for (let i = 0; i < driversList.length; i++) {
            const driver = driversList[i]
            if (driver.driverSetting) {
                driver.driverSetting.status = statuses[i % statuses.length]
                // Randomize location around Abidjan
                driver.driverSetting.currentLat = centerAbidjan.lat + (Math.random() - 0.5) * 0.1
                driver.driverSetting.currentLng = centerAbidjan.lng + (Math.random() - 0.5) * 0.1
                driver.driverSetting.mileage = Math.floor(Math.random() * 150)
                await driver.driverSetting.save()
            }
        }
        console.log(`  ✅ Updated ${driversList.length} driver status and locations`)

        // 5. Set active zones for ETP mode (via CompanyDriverSetting)
        const companyZones = await Zone.query().where('ownerType', 'Company').where('ownerId', fastDelivery.id)
        const cdsList = await CompanyDriverSetting.query().where('companyId', fastDelivery.id).where('status', 'ACCEPTED')

        for (let i = 0; i < cdsList.length; i++) {
            const cds = cdsList[i]
            const zone = companyZones[i % companyZones.length]
            if (zone) {
                cds.activeZoneId = zone.id
                await cds.save()
            }
        }
        console.log(`  ✅ Set active zones for ${cdsList.length} company drivers`)

        console.log('✅ Zones seeding completed\n')
    }
}

