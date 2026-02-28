import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'payment_policies'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.boolean('platform_commission_exempt').defaultTo(false).after('platform_commission_fixed')
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('platform_commission_exempt')
        })
    }
}
