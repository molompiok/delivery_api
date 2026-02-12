import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'stops'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Rename sequence → display_order (preserving existing data)
      table.renameColumn('sequence', 'display_order')
    })

    // Second alter needed because renameColumn + addColumn in same block can cause issues on some drivers
    this.schema.alterTable(this.tableName, (table) => {
      // Add execution_order (nullable — null until first VROOM calculation)
      table.integer('execution_order').nullable().defaultTo(null)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('execution_order')
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.renameColumn('display_order', 'sequence')
    })
  }
}