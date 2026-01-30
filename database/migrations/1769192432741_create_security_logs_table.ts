import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'security_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.string('type').notNullable().index() // RATE_LIMIT, SUSPICIOUS_PAYLOAD, etc.
      table.string('severity').notNullable() // INFO, WARNING, CRITICAL
      table.string('source').notNullable() // SOCKET, API, etc.
      table.string('ip_address').notNullable()
      table.string('user_id').nullable().index()
      
      table.jsonb('meta_data').nullable() // Context like limit exceeded, path, etc.
      table.text('details').nullable() // Human readable details

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}