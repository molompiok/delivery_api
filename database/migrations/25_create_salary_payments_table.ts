import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'salary_payments'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()

            table.string('company_driver_setting_id').notNullable().references('id').inTable('company_driver_settings').onDelete('CASCADE')
            table.string('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE')
            table.string('driver_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

            table.timestamp('period_start').notNullable()
            table.timestamp('period_end').notNullable()

            table.integer('base_salary').notNullable().defaultTo(0)
            table.integer('bonuses').notNullable().defaultTo(0)
            table.integer('deductions').notNullable().defaultTo(0)
            table.integer('total_amount').notNullable().defaultTo(0)

            table.string('status').notNullable().defaultTo('DRAFT')

            // Référence wave-api
            table.string('internal_payment_intent_id').nullable()
            table.timestamp('paid_at').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()

            // Index
            table.index(['company_driver_setting_id'])
            table.index(['company_id'])
            table.index(['driver_id'])
            table.index(['status'])
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
