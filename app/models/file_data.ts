import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'

export interface AccessList {
  userIds: string[]
  companyIds: string[]
  companyDriverIds: string[]  // All drivers of these companies get access
  dynamicQuery: string | null // SQL query that returns user IDs (game changer)
}

export interface FileConfig {
  maxSize?: string       // e.g. "5MB"
  maxFiles?: number      // e.g. 3
  allowedExt?: string[]  // e.g. ["pdf", "jpg"]
  encrypt?: boolean
}

export default class FileData extends BaseModel {
  static table = 'file_permissions'

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(model: FileData) {
    if (!model.id) {
      model.id = generateId('fdt')
    }
  }

  // Polymorphic reference
  @column({ columnName: 'table_name' })
  declare tableName: string

  @column({ columnName: 'table_column' })
  declare tableColumn: string

  @column({ columnName: 'table_id' })
  declare tableId: string

  // Immutable owner (never changes)
  @column({ columnName: 'owner_id' })
  declare ownerId: string

  // Access control lists
  @column({
    columnName: 'read_access',
    prepare: (value: AccessList) => JSON.stringify(value),
    consume: (value: string) => (typeof value === 'string' ? JSON.parse(value) : value)
  })
  declare readAccess: AccessList

  @column({
    columnName: 'write_access',
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

  /**
   * Synchronous write check (for backward compatibility)
   * Does NOT evaluate companyDriverIds or dynamicQuery
   */
  canWrite(userId: string, userCompanyId?: string | null): boolean {
    // Owner always has write access
    if (userId === this.ownerId) return true

    // Check write list - explicit user
    if (this.writeAccess.userIds.includes(userId)) return true

    // Check write list - company managers
    if (userCompanyId && this.writeAccess.companyIds.includes(userCompanyId)) return true

    return false
  }

  /**
   * Synchronous read check (for backward compatibility)
   * Does NOT evaluate companyDriverIds or dynamicQuery
   */
  canRead(userId: string, userCompanyId?: string | null): boolean {
    // Write implies Read
    if (this.canWrite(userId, userCompanyId)) return true

    // Check read list
    if (this.readAccess.userIds.includes(userId)) return true
    if (userCompanyId && this.readAccess.companyIds.includes(userCompanyId)) return true

    return false
  }

  /**
   * Async write check - evaluates companyDriverIds and dynamicQuery
   */
  async canWriteAsync(userId: string, userCompanyId?: string | null): Promise<boolean> {
    // Sync checks first
    if (this.canWrite(userId, userCompanyId)) return true

    // Check companyDriverIds - is user a driver for one of these companies?
    if (this.writeAccess.companyDriverIds.length > 0) {
      const { default: db } = await import('@adonisjs/lucid/services/db')
      const driverEntry = await db.from('company_driver_settings')
        .where('user_id', userId)
        .whereIn('company_id', this.writeAccess.companyDriverIds)
        .where('status', 'APPROVED')
        .first()
      if (driverEntry) return true
    }

    // Check dynamicQuery - execute SQL and see if userId is in results
    if (this.writeAccess.dynamicQuery) {
      const allowed = await this.executeDynamicQuery(this.writeAccess.dynamicQuery)
      if (allowed.includes(userId)) return true
    }

    return false
  }

  /**
   * Async read check - evaluates companyDriverIds and dynamicQuery
   */
  async canReadAsync(userId: string, userCompanyId?: string | null): Promise<boolean> {
    // Write implies Read
    if (await this.canWriteAsync(userId, userCompanyId)) return true

    // Sync read checks
    if (this.readAccess.userIds.includes(userId)) return true
    if (userCompanyId && this.readAccess.companyIds.includes(userCompanyId)) return true

    // Check companyDriverIds - is user a driver for one of these companies?
    if (this.readAccess.companyDriverIds.length > 0) {
      const { default: db } = await import('@adonisjs/lucid/services/db')
      const driverEntry = await db.from('company_driver_settings')
        .where('user_id', userId)
        .whereIn('company_id', this.readAccess.companyDriverIds)
        .where('status', 'APPROVED')
        .first()
      if (driverEntry) return true
    }

    // Check dynamicQuery
    if (this.readAccess.dynamicQuery) {
      const allowed = await this.executeDynamicQuery(this.readAccess.dynamicQuery)
      if (allowed.includes(userId)) return true
    }

    return false
  }

  /**
   * Execute a dynamic SQL query that returns user IDs
   * Query MUST return a column named 'user_id'
   * Example: "SELECT user_id FROM missions WHERE order_id = 'ord_xxx'"
   */
  private async executeDynamicQuery(query: string): Promise<string[]> {
    try {
      const { default: db } = await import('@adonisjs/lucid/services/db')
      const results = await db.rawQuery(query)
      // Results format depends on driver, but typically rows[0] for pg
      const rows = results.rows || results[0] || []
      return rows.map((r: any) => r.user_id || r.driver_id).filter(Boolean)
    } catch (error) {
      console.error('[FileData] Dynamic query execution failed:', error)
      return []
    }
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
        readAccess: { userIds: [], companyIds: [], companyDriverIds: [], dynamicQuery: null },
        writeAccess: { userIds: [], companyIds: [], companyDriverIds: [], dynamicQuery: null },
        config
      })
    }

    return fileData
  }
}