import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('calculation_engine').nullable() // 'valhalla', 'osrm', etc.
      table.jsonb('waypoints_summary').nullable()
      table.integer('total_distance_meters').nullable()
      table.integer('total_duration_seconds').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('calculation_engine')
      table.dropColumn('waypoints_summary')
      table.dropColumn('total_distance_meters')
      table.dropColumn('total_duration_seconds')
    })
  }
}