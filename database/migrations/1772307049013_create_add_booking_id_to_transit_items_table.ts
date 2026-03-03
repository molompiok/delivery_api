import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'transit_items'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('booking_id').nullable().references('id').inTable('bookings').onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropForeign(['booking_id'])
      table.dropColumn('booking_id')
    })
  }
}