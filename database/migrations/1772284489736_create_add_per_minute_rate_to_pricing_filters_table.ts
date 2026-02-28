import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'pricing_filters'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('per_minute_rate').defaultTo(0).after('per_km_rate')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('per_minute_rate')
    })
  }
}