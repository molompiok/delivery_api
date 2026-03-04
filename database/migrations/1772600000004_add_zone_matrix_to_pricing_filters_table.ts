import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'pricing_filters'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('zone_matrix_enabled').notNullable().defaultTo(false)
      table.jsonb('zone_matrix').notNullable().defaultTo('{}')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('zone_matrix')
      table.dropColumn('zone_matrix_enabled')
    })
  }
}

