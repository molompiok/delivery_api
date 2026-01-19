import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import File from '#models/file'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export default class Document extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(doc: Document) {
        doc.id = generateId('doc')
    }

    @column()
    declare documentType: string // e.g., 'ASSURANCE', 'PERMIS', 'CNI'

    @column()
    declare fileId: string | null

    @column()
    declare tableName: string // e.g., 'Vehicle', 'CompanyDriverSetting', 'User'

    @column()
    declare tableId: string

    @column()
    declare status: DocumentStatus

    @column()
    declare ownerId: string // User ID or Company ID

    @column()
    declare ownerType: 'User' | 'Company'

    @column({
        prepare: (value: any) => JSON.stringify(value || {}),
        consume: (value: any) => typeof value === 'string' ? JSON.parse(value) : value
    })
    declare metadata: Record<string, any> // History and logs (non-modifiable by business logic once written)

    @column()
    declare validationComment: string | null

    @column()
    declare isDeleted: boolean

    @column.dateTime()
    declare expireAt: DateTime | null

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => File)
    declare file: BelongsTo<typeof File>

    /**
     * Add an entry to the document history
     */
    public addHistory(action: string, actor: any, details: any = {}) {
        const history = this.metadata?.history || []
        history.push({
            timestamp: DateTime.now().toISO(),
            action,
            actorId: actor.id || 'system',
            actorTable: actor.constructor.name || 'System',
            ...details
        })
        this.metadata = { ...this.metadata, history }
    }
}
