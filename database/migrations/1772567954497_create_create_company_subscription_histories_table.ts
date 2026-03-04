import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'company_subscription_histories'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()
      table.string('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE')
      table.string('activity_type').notNullable()
      table.integer('base_amount').notNullable()
      table.float('commande_commission_percent').notNullable()
      table.float('ticket_fee_percent').notNullable()
      table.float('tax_percent').notNullable()
      table.string('currency').notNullable()

      table.string('plan_id').nullable().references('id').inTable('subscription_plans').onDelete('SET NULL')
      table.string('override_id').nullable().references('id').inTable('company_subscription_overrides').onDelete('SET NULL')

      table.timestamp('effective_from').notNullable()
      table.timestamp('effective_until').nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')

      table.index(['company_id', 'effective_from', 'effective_until'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}