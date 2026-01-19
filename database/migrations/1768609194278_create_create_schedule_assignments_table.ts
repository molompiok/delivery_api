import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'schedule_assignments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('schedule_id').notNullable().references('schedules.id').onDelete('CASCADE')
      table.string('user_id').notNullable().references('users.id').onDelete('CASCADE')
      table.string('assigned_by').nullable().references('users.id').onDelete('SET NULL')

      table.timestamp('assigned_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })

      // Indexes for performance
      table.index(['schedule_id'])
      table.index(['user_id'])

      // Unique constraint to prevent duplicate assignments
      table.unique(['schedule_id', 'user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}