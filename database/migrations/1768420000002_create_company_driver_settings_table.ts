import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'company_driver_settings'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE')
            table.string('driver_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
            table.enum('status', ['PENDING', 'ACCEPTED', 'REJECTED', 'REMOVED']).defaultTo('PENDING').notNullable()

            table.timestamp('invited_at').notNullable()
            table.timestamp('accepted_at').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()

            // Unique constraint: one active relationship per driver per company
            table.unique(['company_id', 'driver_id'])
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
