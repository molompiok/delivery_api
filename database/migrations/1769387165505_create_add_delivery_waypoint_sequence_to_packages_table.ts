import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'packages'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('delivery_waypoint_sequence').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('delivery_waypoint_sequence')
    })
  }
}