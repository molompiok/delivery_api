import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'stops'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.decimal('reversal_amount', 12, 2).defaultTo(0).notNullable()
      table.boolean('include_withdrawal_fees').defaultTo(true).notNullable()
      table.decimal('delivery_fee', 12, 2).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('reversal_amount')
      table.dropColumn('include_withdrawal_fees')
      table.dropColumn('delivery_fee')
    })
  }
}