import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'orders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.index(['company_id', 'template', 'status', 'delivered_at'], 'orders_billing_perf_idx')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['company_id', 'template', 'status', 'delivered_at'], 'orders_billing_perf_idx')
    })
  }
}