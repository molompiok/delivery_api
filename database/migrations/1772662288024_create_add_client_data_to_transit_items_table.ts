import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'transit_items'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('client_name').nullable()
      table.string('client_phone').nullable()
      table.string('client_reference').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('client_name')
      table.dropColumn('client_phone')
      table.dropColumn('client_reference')
    })
  }
}