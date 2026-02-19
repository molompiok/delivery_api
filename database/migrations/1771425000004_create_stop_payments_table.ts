import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'stop_payments'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()

            table.string('order_payment_id').notNullable().references('id').inTable('order_payments').onDelete('CASCADE')
            table.string('stop_id').notNullable().references('id').inTable('stops').onDelete('CASCADE')

            table.integer('amount').notNullable().defaultTo(0)
            table.string('status').notNullable().defaultTo('PENDING')

            table.string('payment_intent_id').nullable()
            table.timestamp('paid_at').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()

            // Index
            table.index(['order_payment_id'])
            table.index(['stop_id'])
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
