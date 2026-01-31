import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

router.get('/init-scenario-3', async () => {
    const User = (await import('#models/user')).default
    const File = (await import('#models/file')).default
    const Document = (await import('#models/document')).default
    const DriverSetting = (await import('#models/driver_setting')).default
    const { DateTime } = await import('../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js')

    const driver = await User.updateOrCreate(
        { phone: '+2250808080808' },
        {
            fullName: 'Marc Ivoirien',
            email: 'marc@example.com',
            isDriver: true
        }
    )

    await DriverSetting.updateOrCreate(
        { userId: driver.id },
        {
            vehicleType: 'Moto',
            vehiclePlate: 'MARC-01-CI',
            status: 'OFFLINE'
        }
    )

    const licenceFile = await File.updateOrCreate(
        { tableName: 'User', tableId: driver.id, tableColumn: 'dct_licence' },
        {
            name: 'permis_marc.pdf',
            path: 'uploads/users/permis.pdf',
            mimeType: 'application/pdf',
            size: 1024,
            fileCategory: 'DOCS' as any,
            isPublic: false
        }
    )

    const identityFile = await File.updateOrCreate(
        { tableName: 'User', tableId: driver.id, tableColumn: 'dct_identity' },
        {
            name: 'cni_marc.jpg',
            path: 'uploads/users/cni.jpg',
            mimeType: 'image/jpeg',
            size: 2048,
            fileCategory: 'DOCS' as any,
            isPublic: false
        }
    )

    await Document.updateOrCreate(
        { tableName: 'User', tableId: driver.id, documentType: 'licence' },
        {
            fileId: licenceFile.id,
            status: 'APPROVED',
            ownerId: driver.id,
            ownerType: 'User',
            metadata: {
                history: [{
                    action: 'ADMIN_VALIDATION',
                    timestamp: DateTime.now().toISO(),
                    user: 'Sublymus Admin'
                }]
            }
        }
    )

    await Document.updateOrCreate(
        { tableName: 'User', tableId: driver.id, documentType: 'identity' },
        {
            fileId: identityFile.id,
            status: 'APPROVED',
            ownerId: driver.id,
            ownerType: 'User',
            metadata: {
                history: [{
                    action: 'ADMIN_VALIDATION',
                    timestamp: DateTime.now().toISO(),
                    user: 'Sublymus Admin'
                }]
            }
        }
    )

    const token = await User.accessTokens.create(driver)

    return {
        message: 'Scenario 3 initialized for Marc (+2250808080808)',
        driverToken: token.value!.release()
    }
})

router
    .group(() => {
        // Test route for API Key auth
        router.get('/test-key', async () => {
            return { message: 'Api Key Auth Working' }
        }).use(middleware.api())
    })
    .prefix('/v1/external')
