import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'driver_settings'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
            table.string('company_id').nullable().references('id').inTable('companies').onDelete('CASCADE')

            table.string('vehicle_type').nullable()
            table.string('vehicle_plate').nullable()

            table.string('verification_status').defaultTo('PENDING')
            table.string('status').defaultTo('OFFLINE')

            table.double('current_lat').nullable()
            table.double('current_lng').nullable()
            table.double('heading').nullable()
            table.double('mileage').defaultTo(0)

            table.string('active_zone_id').nullable().references('id').inTable('zones').onDelete('SET NULL')
            table.string('active_vehicle_id').nullable().references('id').inTable('vehicles').onDelete('SET NULL')

            table.string('current_mode').notNullable().defaultTo('IDEP')
            table.boolean('allow_chaining').defaultTo(true)

            table.boolean('is_online').defaultTo(false)
            table.jsonb('last_location').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
