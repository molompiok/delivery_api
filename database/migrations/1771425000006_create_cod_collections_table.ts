import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'cod_collections'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()

            table.string('order_payment_id').notNullable().references('id').inTable('order_payments').onDelete('CASCADE')
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.string('driver_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
            table.string('stop_id').nullable().references('id').inTable('stops').onDelete('SET NULL')

            table.integer('expected_amount').notNullable().defaultTo(0)
            table.integer('collected_amount').notNullable().defaultTo(0)
            table.integer('change_given').notNullable().defaultTo(0)
            table.string('change_method').nullable() // 'CASH' | 'WAVE'
            table.string('client_wave_phone').nullable()

            table.string('settlement_mode').notNullable().defaultTo('IMMEDIATE')
            table.string('deferred_reason').nullable()

            table.string('status').notNullable().defaultTo('PENDING')

            table.timestamp('collected_at').nullable()
            table.timestamp('settled_at').nullable()

            // Preuve
            table.string('proof_photo_url').nullable()
            table.text('notes').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()

            // Index
            table.index(['order_payment_id'])
            table.index(['order_id'])
            table.index(['driver_id'])
            table.index(['status'])
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
