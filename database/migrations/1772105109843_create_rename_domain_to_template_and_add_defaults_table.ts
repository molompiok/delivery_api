import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // 1. Rename domain to template
    this.schema.alterTable('orders', (table) => {
      table.renameColumn('domain', 'template')
    })
    this.schema.alterTable('pricing_filters', (table) => {
      table.renameColumn('domain', 'template')
    })
    this.schema.alterTable('payment_policies', (table) => {
      table.renameColumn('domain', 'template')
    })

    // 2. Add default_template to companies
    this.schema.alterTable('companies', (table) => {
      table.string('default_template').nullable().defaultTo('COMMANDE').after('owner_id')
    })

    // 3. Add default_template to driver_settings
    this.schema.alterTable('driver_settings', (table) => {
      table.string('default_template').nullable().defaultTo('COMMANDE').after('current_company_id')
    })
  }

  async down() {
    this.schema.alterTable('orders', (table) => {
      table.renameColumn('template', 'domain')
    })
    this.schema.alterTable('pricing_filters', (table) => {
      table.renameColumn('template', 'domain')
    })
    this.schema.alterTable('payment_policies', (table) => {
      table.renameColumn('template', 'domain')
    })

    this.schema.alterTable('companies', (table) => {
      table.dropColumn('default_template')
    })

    this.schema.alterTable('driver_settings', (table) => {
      table.dropColumn('default_template')
    })
  }
}