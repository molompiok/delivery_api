import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'add_leg_id_to_orders'

  async up() {
    this.schema.alterTable('orders', (table) => {
      table.string('leg_id').nullable().references('id').inTable('order_legs').onDelete('SET NULL')
    })
    this.schema.alterTable('order_legs', (table) => {
      table.dropColumn('sequence')
    })
  }

  async down() {
    this.schema.alterTable('orders', (table) => {
      table.dropColumn('leg_id')
    })
    this.schema.alterTable('order_legs', (table) => {
      table.integer('sequence').notNullable().defaultTo(0)
    })
  }
}