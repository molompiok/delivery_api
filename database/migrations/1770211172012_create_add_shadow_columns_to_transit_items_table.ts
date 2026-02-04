import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('transit_items', (table) => {
      table.string('original_id').nullable().references('id').inTable('transit_items').onDelete('SET NULL')
      table.boolean('is_pending_change').defaultTo(false)
      table.boolean('is_delete_required').defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable('transit_items', (table) => {
      table.dropColumn('original_id')
      table.dropColumn('is_pending_change')
      table.dropColumn('is_delete_required')
    })
  }
}