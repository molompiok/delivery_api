import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Document from '#models/document'
import User from '#models/user'

export default class TestDriverDocumentsSeeder extends BaseSeeder {
    async run() {
        console.log('📄 Seeding test driver documents...')

        // Find our test driver: Aissatou Diop
        const driver = await User.findBy('phone', '+2250700000302')
        if (!driver) {
            console.log('❌ Test driver not found')
            return
        }

        console.log(`Found driver: ${driver.fullName} (${driver.id})`)

        // Create documents for this driver (tableName: User)
        const documents = [
            {
                tableName: 'User',
                tableId: driver.id,
                documentType: 'PERMIS_CONDUIRE',
                status: 'PENDING' as const,
                ownerId: driver.id,
                ownerType: 'User' as const,
                fileId: null, // Pas de fichier pour le moment
                isDeleted: false,
                metadata: {
                    history: [
                        {
                            timestamp: new Date().toISOString(),
                            action: 'CREATED_FOR_TEST',
                            actorId: 'system',
                            actorTable: 'System'
                        }
                    ]
                }
            },
            {
                tableName: 'User',
                tableId: driver.id,
                documentType: 'CARTE_IDENTITE',
                status: 'PENDING' as const,
                ownerId: driver.id,
                ownerType: 'User' as const,
                fileId: null,
                isDeleted: false,
                metadata: {
                    history: [
                        {
                            timestamp: new Date().toISOString(),
                            action: 'CREATED_FOR_TEST',
                            actorId: 'system',
                            actorTable: 'System'
                        }
                    ]
                }
            },
            {
                tableName: 'User',
                tableId: driver.id,
                documentType: 'ASSURANCE_VEHICULE',
                status: 'PENDING' as const,
                ownerId: driver.id,
                ownerType: 'User' as const,
                fileId: null,
                isDeleted: false,
                metadata: {
                    history: [
                        {
                            timestamp: new Date().toISOString(),
                            action: 'CREATED_FOR_TEST',
                            actorId: 'system',
                            actorTable: 'System'
                        }
                    ]
                }
            }
        ]

        for (const docData of documents) {
            const existing = await Document.query()
                .where('tableName', docData.tableName)
                .where('tableId', docData.tableId)
                .where('documentType', docData.documentType)
                .where('isDeleted', false)
                .first()

            if (existing) {
                console.log(`  ⚠️  Document ${docData.documentType} already exists, skipping`)
            } else {
                await Document.create(docData)
                console.log(`  ✅ Created document: ${docData.documentType}`)
            }
        }

        console.log('✅ Test driver documents seeded\\n')
    }
}
