import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'driver_settings'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.enum('verification_status', ['PENDING', 'VERIFIED', 'REJECTED']).defaultTo('PENDING')
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('verification_status')
        })
    }
}
