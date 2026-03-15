import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'driver_settings'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.string('wallet_id').nullable()
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('wallet_id')
        })
    }
}
