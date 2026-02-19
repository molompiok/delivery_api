import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'order_payments'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()

            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.string('payment_policy_id').nullable().references('id').inTable('payment_policies').onDelete('SET NULL')

            // Montants calculés
            table.integer('total_amount').notNullable().defaultTo(0)
            table.integer('driver_amount').notNullable().defaultTo(0)
            table.integer('company_amount').notNullable().defaultTo(0)
            table.integer('platform_amount').notNullable().defaultTo(0)

            // Wallets impliqués
            table.string('client_wallet_id').nullable()
            table.string('driver_wallet_id').nullable()
            table.string('company_wallet_id').nullable()
            table.string('platform_wallet_id').nullable()

            // Statut
            table.string('payment_status').notNullable().defaultTo('PENDING')

            // Références wave-api
            table.string('payment_intent_id').nullable()
            table.string('internal_payment_intent_id').nullable()

            // Progressif
            table.integer('paid_amount').notNullable().defaultTo(0)
            table.integer('remaining_amount').notNullable().defaultTo(0)

            // COD
            table.integer('cod_amount').nullable()
            table.string('cod_status').nullable().defaultTo('NONE')

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()

            // Index
            table.index(['order_id'])
            table.index(['payment_status'])
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
