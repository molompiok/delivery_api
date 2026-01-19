import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'vehicles'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('brand').notNullable()
            table.string('model').notNullable()
            table.string('plate').notNullable()
            table.string('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE')
            table.string('assigned_driver_id').nullable().references('id').inTable('users').onDelete('SET NULL')

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
