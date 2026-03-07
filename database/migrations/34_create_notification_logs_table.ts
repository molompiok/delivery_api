import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'notification_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary().notNullable()

      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('channel').notNullable() // PUSH | SMS
      table.string('type').notNullable()
      table.string('title').notNullable()
      table.text('body').notNullable()
      table.string('order_id').nullable().references('id').inTable('orders').onDelete('SET NULL')
      table.string('status').notNullable().defaultTo('SKIPPED') // SENT | FAILED | SKIPPED

      table.string('provider').nullable() // firebase, sms-gateway, ...
      table.string('provider_message_id').nullable()
      table.string('error_code').nullable()
      table.text('error_message').nullable()
      table.string('token_snapshot').nullable()
      table.jsonb('data').notNullable().defaultTo('{}')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['user_id'])
      table.index(['order_id'])
      table.index(['type'])
      table.index(['status'])
      table.index(['created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
