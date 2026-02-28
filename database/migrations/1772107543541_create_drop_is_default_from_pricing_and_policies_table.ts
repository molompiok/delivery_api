import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('pricing_filters', (table) => {
      table.dropColumn('is_default')
    })
    this.schema.alterTable('payment_policies', (table) => {
      table.dropColumn('is_default')
    })
  }

  async down() {
    this.schema.alterTable('pricing_filters', (table) => {
      table.boolean('is_default').defaultTo(false).after('isActive')
    })
    this.schema.alterTable('payment_policies', (table) => {
      table.boolean('is_default').defaultTo(false).after('isActive')
    })
  }
}