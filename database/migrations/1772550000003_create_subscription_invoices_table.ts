import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'subscription_invoices'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary().notNullable()
      table
        .string('company_id')
        .notNullable()
        .references('id')
        .inTable('companies')
        .onDelete('CASCADE')
      table.string('activity_type_snapshot').notNullable()
      table.date('period_start').notNullable()
      table.date('period_end').notNullable()

      table.integer('base_amount').notNullable().defaultTo(0)
      table.float('commande_commission_percent').notNullable().defaultTo(0)
      table.float('ticket_fee_percent').notNullable().defaultTo(0)
      table.float('tax_percent').notNullable().defaultTo(0)
      table.string('currency').notNullable().defaultTo('XOF')

      table.float('commande_usage_amount').notNullable().defaultTo(0)
      table.float('ticket_usage_amount').notNullable().defaultTo(0)
      table.integer('commande_commission_amount').notNullable().defaultTo(0)
      table.integer('ticket_fee_amount').notNullable().defaultTo(0)
      table.integer('total_amount').notNullable().defaultTo(0)
      table.integer('tax_amount').notNullable().defaultTo(0)
      table.integer('total_amount_with_tax').notNullable().defaultTo(0)

      table.string('status').notNullable().defaultTo('ISSUED')
      table.timestamp('issued_at').nullable()
      table.timestamp('due_at').nullable()
      table.timestamp('paid_at').nullable()

      table.string('generated_by').nullable().references('id').inTable('users').onDelete('SET NULL')
      table.jsonb('metadata').notNullable().defaultTo('{}')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['company_id', 'period_start', 'period_end'])
      table.index(['company_id'])
      table.index(['status'])
      table.index(['period_start', 'period_end'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
