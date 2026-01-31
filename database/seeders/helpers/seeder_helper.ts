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
 * Helper to upload a fake file using FileManager
 * Creates the file directly in the File model without going through HTTP context
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
    const File = (await import('#models/file')).default
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const crypto = await import('node:crypto')

    const category = options.category || 'PDF'
    const ext = category === 'IMAGE' ? 'png' : category === 'PDF' ? 'pdf' : 'json'
    const mimeType = category === 'IMAGE' ? 'image/png' : category === 'PDF' ? 'application/pdf' : 'application/json'
    const finalFileName = options.fileName || `fake_${category.toLowerCase()}.${ext}`
    console.log(`Generating fake file: ${finalFileName}`)

    // Create content
    const content = createFakeFileContent(category)

    // Generate unique filename
    const uniqueName = `${crypto.randomBytes(16).toString('hex')}.${ext}`

    // Storage path
    const storagePath = path.join(process.cwd(), 'storage', 'uploads')
    await fs.mkdir(storagePath, { recursive: true })
    const filePath = path.join(storagePath, uniqueName)

    // Write file to disk
    await fs.writeFile(filePath, content)

    // Create File record
    const file = await File.create({
        tableName,
        tableColumn,
        tableId,
        name: uniqueName,
        path: filePath,
        mimeType,
        size: content.length,
        isEncrypted: options.encrypt || false,
        fileCategory: 'OTHER',
    })

    return file.id
}

export default class SeederHelper extends BaseSeeder {
    async run() {
        // This is just a helper class, no run needed
    }
}
