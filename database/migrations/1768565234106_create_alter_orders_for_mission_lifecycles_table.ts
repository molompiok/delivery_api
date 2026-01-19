import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Expand status or note: if it's a string column we might just need to update logic.
      // In delivery-api, it's a string. We'll add the new fields.
      table.string('offered_driver_id').references('users.id').onDelete('SET NULL').nullable()
      table.timestamp('offer_expires_at').nullable()
      table.string('driver_id').references('users.id').onDelete('SET NULL').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('offered_driver_id')
      table.dropColumn('offer_expires_at')
      table.dropColumn('driver_id')
    })
  }
}