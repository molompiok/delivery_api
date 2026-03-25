import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'favorites'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary().notNullable()

      table.string('owner_type').notNullable()
      table.string('owner_id').notNullable()

      table.string('table_name').notNullable()
      table.string('table_id').notNullable()
      table.string('context').notNullable().defaultTo('')

      table.string('kind').notNullable()
      table.string('source').notNullable().defaultTo('implicit')

      table.boolean('is_pinned').notNullable().defaultTo(false)
      table.integer('usage_count').notNullable().defaultTo(1)
      table.timestamp('last_used_at').notNullable()

      table.jsonb('snapshot').notNullable().defaultTo('{}')
      table.jsonb('metadata').notNullable().defaultTo('{}')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['owner_type', 'owner_id', 'table_name', 'table_id', 'context'])
      table.index(['owner_type', 'owner_id'])
      table.index(['owner_type', 'owner_id', 'kind'])
      table.index(['owner_type', 'owner_id', 'kind', 'context'])
      table.index(['last_used_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
