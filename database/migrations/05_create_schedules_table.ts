import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'schedules'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('label').notNullable()
            table.string('owner_type').notNullable() // Company, User
            table.string('owner_id').notNullable()

            table.string('schedule_type').notNullable()
            table.string('schedule_category').defaultTo('WORK')
            table.string('recurrence_type').notNullable()

            table.integer('day_of_week').nullable()
            table.date('specific_date').nullable()
            table.date('start_date').nullable()
            table.date('end_date').nullable()

            table.string('start_time').notNullable()
            table.string('end_time').notNullable()
            table.string('timezone').defaultTo('UTC')
            table.integer('priority').defaultTo(0)

            table.boolean('is_active').defaultTo(true)
            table.boolean('is_public').defaultTo(false)

            table.string('title').nullable()
            table.text('description').nullable()
            table.string('color').nullable()
            table.string('icon').nullable()
            table.json('links').nullable()
            table.boolean('affects_availability').defaultTo(true)

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        this.schema.createTable('schedule_assignments', (table) => {
            table.increments('id').primary().notNullable()
            table.string('schedule_id').notNullable().references('id').inTable('schedules').onDelete('CASCADE')
            table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable('schedule_assignments')
        this.schema.dropTable(this.tableName)
    }
}
