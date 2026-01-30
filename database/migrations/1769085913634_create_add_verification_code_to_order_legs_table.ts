import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'order_legs'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('verification_code', 6).nullable()
      table.boolean('is_verified').defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('verification_code')
      table.dropColumn('is_verified')
    })
  }
}