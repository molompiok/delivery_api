import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'vehicles'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Polymorphic ownership
      table.string('owner_type').notNullable().defaultTo('Company')
      table.string('owner_id').notNullable().defaultTo('') // Will migrate existing data later

      // Metadata
      table.string('type').notNullable().defaultTo('MOTO') // MOTO, CAR, VAN...
      table.string('color').nullable()
      table.string('energy').notNullable().defaultTo('GASOLINE')
      table.integer('year').nullable()

      // Specs (JSON)
      table.jsonb('specs').nullable() // { maxWeight, cargoVolume, dims... }

      // Status
      table.string('verification_status').defaultTo('PENDING')
      table.boolean('is_active').defaultTo(true)

      // Clean up old relations if needed or keep for compat
      // We keep company_id and assigned_driver_id for now as they map well
      // But we should migrate company_id to owner_id if owner_type is Company
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('owner_type')
      table.dropColumn('owner_id')
      table.dropColumn('type')
      table.dropColumn('color')
      table.dropColumn('energy')
      table.dropColumn('year')
      table.dropColumn('specs')
      table.dropColumn('verification_status')
      table.dropColumn('is_active')
    })
  }
}