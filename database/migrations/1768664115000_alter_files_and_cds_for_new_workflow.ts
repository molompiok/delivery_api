import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableNameFiles = 'files'
    protected tableNameCds = 'company_driver_settings'

    async up() {
        this.schema.alterTable(this.tableNameFiles, (table) => {
            table.enum('validation_status', ['PENDING', 'APPROVED', 'REJECTED']).defaultTo('PENDING').notNullable()
            table.text('validation_comment').nullable()
        })

        // Update enum for company_driver_settings.status
        // Note: PostgreSQL/MySQL handle this differently. 
        // For development, we'll try to just alter it or use a raw query if needed.
        // In Adonis, if it's already an enum, we might need to recreate it.
        this.schema.alterTable(this.tableNameCds, (table) => {
            // Drop old column and recreate with new enum if needed, or just change type
            // To be safe across DBs:
            table.string('status', 50).notNullable().alter()
        })
    }

    async down() {
        this.schema.alterTable(this.tableNameFiles, (table) => {
            table.dropColumn('validation_status')
            table.dropColumn('validation_comment')
        })
    }
}
