import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'payment_intents'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('metadata').nullable() // JSON as text for SQLite compatibility or native json where supported
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('metadata')
    })
  }
}