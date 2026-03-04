import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('delivered_at').nullable()
      table.index(['delivered_at'])
    })

    this.defer(async (db) => {
      const rows = await db
        .from(this.tableName)
        .select('id', 'updated_at')
        .where('status', 'DELIVERED')
        .whereNull('delivered_at')

      for (const row of rows) {
        await db.from(this.tableName).where('id', row.id).update({ delivered_at: row.updated_at })
      }
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['delivered_at'])
      table.dropColumn('delivered_at')
    })
  }
}
