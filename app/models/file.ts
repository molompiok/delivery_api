import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, computed } from '@adonisjs/lucid/orm'
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
        if (!file.id) {
            file.id = generateId('fil')
        }
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

    /** Metadata (JSONB) for storing extra info like dimensions, duration, etc. */
    @column({
        prepare: (value: any) => JSON.stringify(value || {}),
        consume: (value: any) => typeof value === 'string' ? JSON.parse(value) : value
    })
    declare metadata: Record<string, any> | null

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @computed()
    get url() {
        return `/fs/${this.name}`
    }
}
