import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'async_confirms'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('used_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('used_at')
    })
  }
}