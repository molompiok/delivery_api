import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // Update Steps
    this.schema.alterTable('steps', (table) => {
      table.string('original_id').nullable().references('id').inTable('steps').onDelete('SET NULL')
      table.boolean('is_pending_change').defaultTo(false)
      table.boolean('is_delete_required').defaultTo(false)
    })

    // Update Stops
    this.schema.alterTable('stops', (table) => {
      table.string('original_id').nullable().references('id').inTable('stops').onDelete('SET NULL')
      table.boolean('is_pending_change').defaultTo(false)
      table.boolean('is_delete_required').defaultTo(false)
    })

    // Update Actions
    this.schema.alterTable('actions', (table) => {
      table.string('original_id').nullable().references('id').inTable('actions').onDelete('SET NULL')
      table.boolean('is_pending_change').defaultTo(false)
      table.boolean('is_delete_required').defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable('actions', (table) => {
      table.dropColumn('original_id')
      table.dropColumn('is_pending_change')
      table.dropColumn('is_delete_required')
    })

    this.schema.alterTable('stops', (table) => {
      table.dropColumn('original_id')
      table.dropColumn('is_pending_change')
      table.dropColumn('is_delete_required')
    })

    this.schema.alterTable('steps', (table) => {
      table.dropColumn('original_id')
      table.dropColumn('is_pending_change')
      table.dropColumn('is_delete_required')
    })
  }
}