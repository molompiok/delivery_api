import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'file_data'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()

      // Polymorphic reference (composite unique)
      table.string('table_name').notNullable()
      table.string('table_column').notNullable()
      table.string('table_id').notNullable()

      // Immutable owner
      table.string('owner_id').notNullable()

      // Access control lists (JSON)
      table.json('read_access').defaultTo('{"userIds":[],"companyIds":[]}')
      table.json('write_access').defaultTo('{"userIds":[],"companyIds":[]}')

      // Column configuration (validation rules)
      table.json('config').defaultTo('{}')

      table.timestamp('created_at')
      table.timestamp('updated_at')

      // Composite unique constraint
      table.unique(['table_name', 'table_column', 'table_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}