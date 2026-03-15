import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'payment_intents'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('expires_at').nullable().index()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('expires_at')
    })
  }
}