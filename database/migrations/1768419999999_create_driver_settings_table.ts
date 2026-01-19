import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'driver_settings'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE').unique()

            table.string('idep').nullable()
            table.string('vehicle_type').nullable()
            table.string('vehicle_plate').nullable()
            table.string('current_company_id').nullable().references('id').inTable('companies').onDelete('SET NULL')

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
