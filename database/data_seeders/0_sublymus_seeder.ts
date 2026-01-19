import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Zone from '#models/zone'

/**
 * Seeder for Sublymus global data (zones, documents, etc.)
 * These are system-level resources that can be:
 * - Directly referenced by IDEP drivers (activeZoneId points to Sublymus zone)
 * - Installed (copied) by Companies for customization
 */
export default class SublymusSeeder extends BaseSeeder {
    async run() {
        console.log('🌐 Seeding Sublymus global data...')

        // =====================================================
        // SUBLYMUS ZONES - Global zones available to all
        // =====================================================

        const sublymusZones = [
            // Major cities in Côte d'Ivoire
            {
                id: 'zn_sub_abidjan',
                name: 'Abidjan Métropole',
                color: '#6366f1',
                sector: 'ABIDJAN',
                type: 'circle' as const,
                geometry: {
                    center: { lat: 5.320, lng: -4.020 },
                    radiusKm: 20
                },
                isActive: true
            },
            {
                id: 'zn_sub_abidjan_centre',
                name: 'Abidjan Centre (Plateau, Cocody)',
                color: '#8b5cf6',
                sector: 'ABIDJAN',
                type: 'circle' as const,
                geometry: {
                    center: { lat: 5.340, lng: -3.990 },
                    radiusKm: 6
                },
                isActive: true
            },
            {
                id: 'zn_sub_abidjan_sud',
                name: 'Abidjan Sud (Treichville, Marcory, Port-Bouët)',
                color: '#ec4899',
                sector: 'ABIDJAN',
                type: 'circle' as const,
                geometry: {
                    center: { lat: 5.295, lng: -3.970 },
                    radiusKm: 5
                },
                isActive: true
            },
            {
                id: 'zn_sub_abidjan_nord',
                name: 'Abidjan Nord (Abobo, Anyama)',
                color: '#f59e0b',
                sector: 'ABIDJAN',
                type: 'circle' as const,
                geometry: {
                    center: { lat: 5.420, lng: -4.020 },
                    radiusKm: 7
                },
                isActive: true
            },
            {
                id: 'zn_sub_abidjan_ouest',
                name: 'Abidjan Ouest (Yopougon)',
                color: '#ef4444',
                sector: 'ABIDJAN',
                type: 'circle' as const,
                geometry: {
                    center: { lat: 5.350, lng: -4.100 },
                    radiusKm: 8
                },
                isActive: true
            },
            {
                id: 'zn_sub_yamoussoukro',
                name: 'Yamoussoukro Centre',
                color: '#10b981',
                sector: 'YAMOUSSOUKRO',
                type: 'circle' as const,
                geometry: {
                    center: { lat: 6.820, lng: -5.275 },
                    radiusKm: 10
                },
                isActive: true
            },
            {
                id: 'zn_sub_bouake',
                name: 'Bouaké Centre',
                color: '#14b8a6',
                sector: 'BOUAKE',
                type: 'circle' as const,
                geometry: {
                    center: { lat: 7.690, lng: -5.030 },
                    radiusKm: 8
                },
                isActive: true
            },
            {
                id: 'zn_sub_san_pedro',
                name: 'San-Pédro Port',
                color: '#0ea5e9',
                sector: 'SAN_PEDRO',
                type: 'circle' as const,
                geometry: {
                    center: { lat: 4.750, lng: -6.640 },
                    radiusKm: 6
                },
                isActive: true
            },
            {
                id: 'zn_sub_korhogo',
                name: 'Korhogo Centre',
                color: '#f97316',
                sector: 'KORHOGO',
                type: 'circle' as const,
                geometry: {
                    center: { lat: 9.460, lng: -5.630 },
                    radiusKm: 5
                },
                isActive: true
            },
            {
                id: 'zn_sub_daloa',
                name: 'Daloa Centre',
                color: '#a855f7',
                sector: 'DALOA',
                type: 'circle' as const,
                geometry: {
                    center: { lat: 6.880, lng: -6.450 },
                    radiusKm: 5
                },
                isActive: true
            }
        ]

        for (const zoneData of sublymusZones) {
            await Zone.updateOrCreate(
                { id: zoneData.id },
                {
                    ...zoneData,
                    ownerType: 'Sublymus',
                    ownerId: null,
                    sourceZoneId: null
                }
            )
        }

        console.log(`  ✅ Created ${sublymusZones.length} Sublymus zones`)

        // =====================================================
        // SUBLYMUS DOCUMENTS - Global document types (if needed)
        // =====================================================

        // Note: Document types are typically defined in code/config
        // But we could add seeding here for document templates if needed

        console.log('✅ Sublymus data seeding completed\n')
    }
}
