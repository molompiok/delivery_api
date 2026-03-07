import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'company_b2b_partners'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()
      table.string('company_id').references('id').inTable('companies').onDelete('CASCADE').notNullable()
      table.string('client_id').references('id').inTable('users').onDelete('CASCADE').notNullable()
      table.string('status').notNullable().defaultTo('ACTIVE') // 'ACTIVE', 'SUSPENDED'

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['company_id', 'client_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}