import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'orders'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('client_id').notNullable().references('id').inTable('users')
            table.string('status').notNullable()
            table.json('pricing_data').notNullable().defaultTo('{}')
            table.string('package_id').nullable()
            table.string('pickup_address_id').notNullable().references('id').inTable('addresses')
            table.string('delivery_address_id').notNullable().references('id').inTable('addresses')

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
