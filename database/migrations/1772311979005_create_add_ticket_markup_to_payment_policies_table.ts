import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'payment_policies'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.float('ticket_markup_percent').notNullable().defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('ticket_markup_percent')
    })
  }
}