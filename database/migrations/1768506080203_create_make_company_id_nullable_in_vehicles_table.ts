import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'vehicles'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('company_id').nullable().alter()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      // Revert to not nullable - careful with data
      table.string('company_id').notNullable().alter()
    })
  }
}