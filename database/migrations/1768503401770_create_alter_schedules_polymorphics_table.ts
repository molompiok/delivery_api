import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'schedules'

  async up() {
    // 1. Add new columns
    this.schema.alterTable(this.tableName, (table) => {
      // Polymorphic ownership
      table.string('owner_type').notNullable().defaultTo('User')
      table.string('owner_id').nullable() // Temporarily nullable to migrate data

      // Types
      table.string('schedule_type').notNullable().defaultTo('WORK')
      table.string('recurrence_type').notNullable().defaultTo('WEEKLY')

      // Time/Date fields
      table.date('specific_date').nullable()
      table.date('start_date').nullable()
      table.date('end_date').nullable()

      // Metadata
      table.string('label').nullable()
      table.string('timezone').defaultTo('Africa/Abidjan')
      table.integer('priority').defaultTo(10)

      // Modify existing
      table.integer('day_of_week').nullable().alter()
    })

    // 2. Migrate existing data (User ID -> owner_id)
    this.defer(async (db) => {
      await db.from(this.tableName).update({
        owner_id: db.raw('user_id'),
        owner_type: 'User',
        schedule_type: 'WORK',
        recurrence_type: 'WEEKLY'
      })
    })

    // 3. Make owner_id not nullable and drop user_id
    this.schema.alterTable(this.tableName, (table) => {
      table.string('owner_id').notNullable().alter()
      table.dropColumn('user_id')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('user_id').nullable()
    })

    // Restore user_id from owner_id where type is User
    this.defer(async (db) => {
      await db.from(this.tableName)
        .where('owner_type', 'User')
        .update({
          user_id: db.raw('owner_id')
        })
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.string('user_id').notNullable().alter()
      table.integer('day_of_week').notNullable().alter()

      table.dropColumn('owner_type')
      table.dropColumn('owner_id')
      table.dropColumn('schedule_type')
      table.dropColumn('recurrence_type')
      table.dropColumn('specific_date')
      table.dropColumn('start_date')
      table.dropColumn('end_date')
      table.dropColumn('label')
      table.dropColumn('timezone')
      table.dropColumn('priority')
    })
  }
}