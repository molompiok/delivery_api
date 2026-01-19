import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Use try/catch or conditional check if possible, but Lucid doesn't support hasColumn easily in migration
      // We will assume they don't exist, or we can use raw SQL to be safe if this is a persistent issue.
      // For now, let's try standard approach.
      table.string('ref_id').nullable().index()
      table.enum('assignment_mode', ['GLOBAL', 'INTERNAL', 'TARGET']).defaultTo('GLOBAL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('ref_id')
      table.dropColumn('assignment_mode')
    })
  }
}