import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'

/**
 * FileCategory defines what operations can be performed on a file
 * - IMAGE: compress, scale, resize, addLogo, rotate, effects
 * - VIDEO: transcode, thumbnail, compress
 * - DOCS: preview, convert
 * - JSON: parse, validate
 * - BINARY: raw storage only
 * - OTHER: unknown category
 */
export type FileCategory = 'IMAGE' | 'VIDEO' | 'DOCS' | 'BINARY' | 'JSON' | 'OTHER'

export default class File extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(file: File) {
        file.id = generateId('fil')
    }

    @column()
    declare path: string

    @column()
    declare name: string

    @column()
    declare tableName: string

    @column()
    declare tableColumn: string

    @column()
    declare tableId: string

    /** The actual MIME type (e.g., image/png, application/pdf) */
    @column()
    declare mimeType: string | null

    @column()
    declare size: number | null

    @column()
    declare isEncrypted: boolean

    /** Category for processing operations (IMAGE, VIDEO, DOCS, BINARY, JSON, OTHER) */
    @column()
    declare fileCategory: FileCategory

    /** Metadata (JSONB) for storing extra info like expiryDate, docNumber */
    @column()
    declare metadata: Record<string, any> | null

    @column()
    declare validationStatus: 'PENDING' | 'APPROVED' | 'REJECTED'

    @column()
    declare validationComment: string | null

    // --- PERMISSIONS ---

    /** If true, file is accessible by anyone without authentication */
    @column()
    declare isPublic: boolean

    /** List of user IDs who can access this file */
    @column({
        prepare: (value: string[]) => JSON.stringify(value || []),
    })
    declare allowedUserIds: string[]

    /** List of company IDs whose managers can access this file */
    @column({
        prepare: (value: string[]) => JSON.stringify(value || []),
    })
    declare allowedCompanyIds: string[]

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null
}
