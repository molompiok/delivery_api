import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'subscription_plans'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary().notNullable()
      table.string('activity_type').notNullable().unique()
      table.integer('base_amount').notNullable().defaultTo(0)
      table.float('commande_commission_percent').notNullable().defaultTo(0)
      table.float('ticket_fee_percent').notNullable().defaultTo(0)
      table.string('currency').notNullable().defaultTo('XOF')
      table.boolean('is_active').notNullable().defaultTo(true)
      table.jsonb('metadata').notNullable().defaultTo('{}')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
