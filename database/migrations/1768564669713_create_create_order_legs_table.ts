import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'order_legs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()
      table.string('order_id').references('orders.id').onDelete('CASCADE')
      table.integer('sequence').notNullable()

      table.string('start_address_id').references('addresses.id').onDelete('SET NULL').nullable()
      table.string('end_address_id').references('addresses.id').onDelete('SET NULL').nullable()

      table.jsonb('start_coordinates').nullable() // { type: 'Point', coordinates: [lon, lat] }
      table.jsonb('end_coordinates').nullable()
      table.jsonb('geometry').nullable() // { type: 'LineString', coordinates: [[lon, lat], ...] }

      table.integer('duration_seconds').nullable()
      table.integer('distance_meters').nullable()
      table.jsonb('maneuvers').nullable()
      table.jsonb('raw_data').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}