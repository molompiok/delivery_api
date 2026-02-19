import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'payment_policies'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()

            table.string('company_id').nullable().references('id').inTable('companies').onDelete('CASCADE')
            table.string('driver_id').nullable().references('id').inTable('users').onDelete('CASCADE')
            table.string('name').notNullable()

            // Quand déclencher le paiement du client
            table.string('client_payment_trigger').notNullable().defaultTo('ON_DELIVERY')
            // Comment payer le driver
            table.string('driver_payment_trigger').notNullable().defaultTo('ON_DELIVERY')

            // Commission de la plateforme
            table.decimal('platform_commission_percent', 5, 2).notNullable().defaultTo(0)
            table.integer('platform_commission_fixed').notNullable().defaultTo(0)

            // Commission de l'entreprise
            table.decimal('company_commission_percent', 5, 2).notNullable().defaultTo(0)
            table.integer('company_commission_fixed').notNullable().defaultTo(0)

            // Progressif
            table.integer('progressive_min_amount').nullable()

            // COD
            table.boolean('allow_cod').notNullable().defaultTo(false)
            table.decimal('cod_fee_percent', 5, 2).notNullable().defaultTo(0)

            table.boolean('is_default').notNullable().defaultTo(false)
            table.boolean('is_active').notNullable().defaultTo(true)

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()

            // Index
            table.index(['company_id'])
            table.index(['driver_id'])
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
