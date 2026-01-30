import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('orders', (table) => {
      table.boolean('is_complex').defaultTo(false)
      table.string('logic_pattern').nullable() // 'G1', 'G2', 'G3', etc.
    })

    this.schema.alterTable('missions', (table) => {
      table.jsonb('optimized_data').nullable() // Stores the VROOM result slice for this mission
      table.integer('estimated_duration').nullable()
      table.integer('estimated_distance').nullable()
      table.jsonb('route_geometry').nullable()
    })
  }

  async down() {
    this.schema.alterTable('orders', (table) => {
      table.dropColumn('is_complex')
      table.dropColumn('logic_pattern')
    })

    this.schema.alterTable('missions', (table) => {
      table.dropColumn('optimized_data')
      table.dropColumn('estimated_duration')
      table.dropColumn('estimated_distance')
      table.dropColumn('route_geometry')
    })
  }
}