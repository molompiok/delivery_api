import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'schedules'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Basic information
      table.string('title').nullable()
      table.text('description').nullable()

      // Category (WORK, LEAVE, MANAGEMENT)
      table.enum('schedule_category', ['WORK', 'LEAVE', 'MANAGEMENT']).defaultTo('WORK')

      // Appearance
      table.string('color').nullable() // Hex color like #3B82F6
      table.string('icon').nullable() // Lucide icon name like 'Briefcase'

      // Links (JSON array of {name, url, icon})
      table.json('links').nullable()

      // Metadata
      table.boolean('affects_availability').defaultTo(true) // false for MANAGEMENT type
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('title')
      table.dropColumn('description')
      table.dropColumn('schedule_category')
      table.dropColumn('color')
      table.dropColumn('icon')
      table.dropColumn('links')
      table.dropColumn('affects_availability')
    })
  }
}