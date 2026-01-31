import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'company_driver_settings'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE')
            table.string('driver_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

            table.string('status').notNullable().defaultTo('INVITED')
            table.timestamp('invited_at').nullable()
            table.timestamp('accepted_at').nullable()

            table.string('docs_status').defaultTo('PENDING')
            table.jsonb('required_doc_types').nullable().defaultTo('[]')

            table.string('active_zone_id').nullable().references('id').inTable('zones').onDelete('SET NULL')
            table.string('active_vehicle_id').nullable().references('id').inTable('vehicles').onDelete('SET NULL')

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
