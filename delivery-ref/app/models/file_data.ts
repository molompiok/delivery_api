import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'

export interface AccessList {
  userIds: string[]
  companyIds: string[]
}

export interface FileConfig {
  maxSize?: string       // e.g. "5MB"
  maxFiles?: number      // e.g. 3
  allowedExt?: string[]  // e.g. ["pdf", "jpg"]
  encrypt?: boolean
}

export default class FileData extends BaseModel {
  static table = 'file_data'

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(model: FileData) {
    if (!model.id) {
      model.id = generateId('fdt')
    }
  }

  // Polymorphic reference
  @column()
  declare tableName: string

  @column()
  declare tableColumn: string

  @column()
  declare tableId: string

  // Immutable owner (never changes)
  @column()
  declare ownerId: string

  // Access control lists
  @column({
    prepare: (value: AccessList) => JSON.stringify(value),
    consume: (value: string) => (typeof value === 'string' ? JSON.parse(value) : value)
  })
  declare readAccess: AccessList

  @column({
    prepare: (value: AccessList) => JSON.stringify(value),
    consume: (value: string) => (typeof value === 'string' ? JSON.parse(value) : value)
  })
  declare writeAccess: AccessList

  // Configuration for this column
  @column({
    prepare: (value: FileConfig) => JSON.stringify(value),
    consume: (value: string) => (typeof value === 'string' ? JSON.parse(value) : value)
  })
  declare config: FileConfig

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // --- Permission Check Methods ---

  canWrite(userId: string, userCompanyId?: string | null): boolean {
    // Owner always has write access
    if (userId === this.ownerId) return true

    // Check write list
    if (this.writeAccess.userIds.includes(userId)) return true
    if (userCompanyId && this.writeAccess.companyIds.includes(userCompanyId)) return true

    return false
  }

  canRead(userId: string, userCompanyId?: string | null): boolean {
    // Write implies Read
    if (this.canWrite(userId, userCompanyId)) return true

    // Check read list
    if (this.readAccess.userIds.includes(userId)) return true
    if (userCompanyId && this.readAccess.companyIds.includes(userCompanyId)) return true

    return false
  }

  // --- Static Helpers ---

  static async getOrCreate(
    tableName: string,
    tableColumn: string,
    tableId: string,
    ownerId: string,
    config: FileConfig = {}
  ): Promise<FileData> {
    let fileData = await FileData.query()
      .where('tableName', tableName)
      .where('tableColumn', tableColumn)
      .where('tableId', tableId)
      .first()

    if (!fileData) {
      fileData = await FileData.create({
        tableName,
        tableColumn,
        tableId,
        ownerId,
        readAccess: { userIds: [], companyIds: [] },
        writeAccess: { userIds: [], companyIds: [] },
        config
      })
    }

    return fileData
  }
}