import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'users'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            // Remove old role enum
            table.dropColumn('role')

            // Add new boolean flags
            table.boolean('is_driver').defaultTo(false).notNullable()
            table.boolean('is_admin').defaultTo(false).notNullable()

            // Add current_company_managed (company_id already exists)
            table.string('current_company_managed').nullable().references('id').inTable('companies').onDelete('SET NULL')
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            // Restore role enum
            table.enum('role', ['ADMIN', 'MANAGER_ETP', 'CLIENT', 'DRIVER']).defaultTo('CLIENT').notNullable()

            // Remove new fields
            table.dropColumn('is_driver')
            table.dropColumn('is_admin')
            table.dropColumn('current_company_managed')
        })
    }
}
