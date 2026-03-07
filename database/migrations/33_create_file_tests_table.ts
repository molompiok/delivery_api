import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'file_tests'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary().notNullable()
      table.string('name').notNullable()
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}