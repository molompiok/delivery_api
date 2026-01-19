import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'
import { DateTime } from 'luxon'

/**
 * Helper to create a user with phone and OTP verification
 */
export async function createUserWithPhone(
    phone: string,
    data: {
        email?: string
        fullName?: string
        isAdmin?: boolean
        isDriver?: boolean
    } = {}
): Promise<User> {
    const user = await User.firstOrCreate(
        { phone },
        {
            phone,
            email: data.email,
            fullName: data.fullName,
            isAdmin: data.isAdmin || false,
            isDriver: data.isDriver || false,
            isActive: true,
            phoneVerifiedAt: DateTime.now(),
            lastLoginAt: DateTime.now(),
        }
    )

    return user
}

/**
 * Helper to create a fake file for testing
 * Returns a Buffer with fake content
 */
export function createFakeFileContent(category: 'IMAGE' | 'PDF' | 'JSON'): Buffer {
    switch (category) {
        case 'IMAGE':
            // Minimal PNG header
            return Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            ])
        case 'PDF':
            return Buffer.from('%PDF-1.4\n%Fake PDF for testing\n%%EOF')
        case 'JSON':
            return Buffer.from(JSON.stringify({ test: true, timestamp: Date.now() }))
        default:
            return Buffer.from('Fake file content')
    }
}

/**
 * Helper to upload a fake file using FileService
 */
export async function uploadFakeFile(
    tableName: string,
    tableId: string,
    tableColumn: string,
    options: {
        category?: 'IMAGE' | 'PDF' | 'JSON'
        fileName?: string
        encrypt?: boolean
        isPublic?: boolean
        allowedUserIds?: string[]
        allowedCompanyIds?: string[]
    } = {}
): Promise<string> {
    const FileService = (await import('#services/file_service')).default
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const os = await import('node:os')

    const category = options.category || 'PDF'
    const fileName = options.fileName || `fake_${category.toLowerCase()}.${category === 'IMAGE' ? 'png' : category === 'PDF' ? 'pdf' : 'json'}`

    // Create temp file
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seeder-'))
    const tmpPath = path.join(tmpDir, fileName)
    const content = createFakeFileContent(category)
    await fs.writeFile(tmpPath, content)

    // Create fake MultipartFile
    const fakeFile = {
        tmpPath,
        clientName: fileName,
        size: content.length,
        type: category === 'IMAGE' ? 'image' : category === 'PDF' ? 'application' : 'application',
        subtype: category === 'IMAGE' ? 'png' : category === 'PDF' ? 'pdf' : 'json',
        extname: category === 'IMAGE' ? 'png' : category === 'PDF' ? 'pdf' : 'json',
        hasErrors: false,
        errors: [],
    } as any

    const result = await FileService.upload(fakeFile, {
        tableName,
        tableColumn,
        tableId,
        encrypt: options.encrypt || false,
        isPublic: options.isPublic || false,
        allowedUserIds: options.allowedUserIds,
        allowedCompanyIds: options.allowedCompanyIds,
    })

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true })

    return result.fileId
}

export default class SeederHelper extends BaseSeeder {
    async run() {
        // This is just a helper class, no run needed
    }
}
