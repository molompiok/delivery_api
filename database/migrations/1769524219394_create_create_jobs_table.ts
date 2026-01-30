import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()
      table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
      table.string('task_id').notNullable().references('id').inTable('tasks').onDelete('CASCADE')

      table.enum('status', ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED']).notNullable().defaultTo('PENDING')

      table.jsonb('metadata').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}