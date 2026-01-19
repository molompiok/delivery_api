import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'company_driver_settings'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.enum('docs_status', ['PENDING', 'APPROVED', 'REJECTED']).defaultTo('PENDING')
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('docs_status')
        })
    }
}
