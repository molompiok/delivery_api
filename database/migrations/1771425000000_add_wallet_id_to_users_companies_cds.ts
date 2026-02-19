import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    async up() {
        this.schema.alterTable('users', (table) => {
            table.string('wallet_id').nullable()
        })
        this.schema.alterTable('companies', (table) => {
            table.string('wallet_id').nullable()
        })
        this.schema.alterTable('company_driver_settings', (table) => {
            table.string('wallet_id').nullable()
        })
    }

    async down() {
        this.schema.alterTable('users', (table) => {
            table.dropColumn('wallet_id')
        })
        this.schema.alterTable('companies', (table) => {
            table.dropColumn('wallet_id')
        })
        this.schema.alterTable('company_driver_settings', (table) => {
            table.dropColumn('wallet_id')
        })
    }
}
