import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'payment_intents'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('metadata')
      table.text('external_id_history').nullable()
      table.text('double_payments_log').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('metadata').nullable()
      table.dropColumn('external_id_history')
      table.dropColumn('double_payments_log')
    })
  }
}