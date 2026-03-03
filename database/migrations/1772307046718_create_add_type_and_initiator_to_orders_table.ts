import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('is_intervention').notNullable().defaultTo(false)
      table.string('initiator_id').nullable()
      table.string('company_id').nullable().references('id').inTable('companies').onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('is_intervention')
      table.dropColumn('initiator_id')
      table.dropForeign(['company_id'])
      table.dropColumn('company_id')
    })
  }
}