import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'addresses'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Polymorphic ownership
      table.string('owner_type').notNullable().defaultTo('User')
      table.string('owner_id').notNullable().defaultTo('') // Should be set properly later

      // Metadata
      table.string('label').notNullable().defaultTo('Principal')
      table.boolean('is_default').defaultTo(false)
      table.boolean('is_active').defaultTo(true)

      // Details
      table.string('street').nullable()
      table.string('city').nullable()
      table.string('zip_code').nullable()
      table.string('country').nullable().defaultTo('Côte d\'Ivoire')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('owner_type')
      table.dropColumn('owner_id')
      table.dropColumn('label')
      table.dropColumn('is_default')
      table.dropColumn('is_active')
      table.dropColumn('street')
      table.dropColumn('city')
      table.dropColumn('zip_code')
      table.dropColumn('country')
    })
  }
}