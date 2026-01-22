import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'driver_settings'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('allow_chaining').defaultTo(true) // Activé par défaut
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('allow_chaining')
    })
  }
}