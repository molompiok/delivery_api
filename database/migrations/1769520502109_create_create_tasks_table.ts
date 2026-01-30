import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'tasks'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()
      table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
      table.string('mission_id').nullable().references('id').inTable('missions').onDelete('SET NULL')
      table.string('address_id').notNullable().references('id').inTable('addresses')

      table.enum('type', ['PICKUP', 'DELIVERY', 'SERVICE']).notNullable()
      table.enum('status', ['PENDING', 'ARRIVED', 'COMPLETED', 'FAILED', 'CANCELLED']).notNullable().defaultTo('PENDING')

      table.integer('sequence').nullable() // Ordered sequence within a mission
      table.integer('service_time').defaultTo(0) // Duration in seconds

      table.timestamp('arrival_time').nullable()
      table.timestamp('completion_time').nullable()

      table.string('verification_code').nullable()
      table.boolean('is_verified').defaultTo(false)

      table.jsonb('metadata').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}