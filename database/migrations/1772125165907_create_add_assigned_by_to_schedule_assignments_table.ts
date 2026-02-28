import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'schedule_assignments'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('assigned_by').nullable().references('id').inTable('users').onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('assigned_by')
    })
  }
}