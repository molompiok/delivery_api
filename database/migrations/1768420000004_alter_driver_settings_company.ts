import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'driver_settings'

    async up() {
        // Remove idep column from driver_settings
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('idep')
        })

        // Rename manager_id to owner_id in companies
        this.schema.alterTable('companies', (table) => {
            table.renameColumn('manager_id', 'owner_id')
        })
    }

    async down() {
        // Re-add idep column
        this.schema.alterTable(this.tableName, (table) => {
            table.string('idep').nullable()
        })

        // Rename owner_id back to manager_id
        this.schema.alterTable('companies', (table) => {
            table.renameColumn('owner_id', 'manager_id')
        })
    }
}
