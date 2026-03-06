import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'bookings'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()
      table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
      table.string('client_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('pickup_stop_id').nullable().references('id').inTable('stops').onDelete('SET NULL')
      table.string('dropoff_stop_id').nullable().references('id').inTable('stops').onDelete('SET NULL')

      // Stocker les places sous forme de JSON (ex: ["A1", "A2"])
      table.json('seats_reserved').nullable()

      table.string('status').notNullable().defaultTo('PENDING') // PENDING, CONFIRMED, CANCELLED

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}