import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('priority').defaultTo('MEDIUM').index() // 'LOW', 'MEDIUM', 'HIGH'
      table.integer('assignment_attempt_count').defaultTo(0)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('priority')
      table.dropColumn('assignment_attempt_count')
    })
  }
}