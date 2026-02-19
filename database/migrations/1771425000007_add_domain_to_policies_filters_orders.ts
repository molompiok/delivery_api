import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    async up() {
        // 1. PaymentPolicy
        this.schema.alterTable('payment_policies', (table) => {
            table.string('domain').nullable().defaultTo(null).after('name')
        })

        // 2. PricingFilter
        this.schema.alterTable('pricing_filters', (table) => {
            table.string('domain').nullable().defaultTo(null).after('name')
        })

        // 3. Order
        this.schema.alterTable('orders', (table) => {
            table.string('domain').nullable().defaultTo(null).after('logic_pattern')
        })
    }

    async down() {
        this.schema.alterTable('payment_policies', (table) => {
            table.dropColumn('domain')
        })
        this.schema.alterTable('pricing_filters', (table) => {
            table.dropColumn('domain')
        })
        this.schema.alterTable('orders', (table) => {
            table.dropColumn('domain')
        })
    }
}
