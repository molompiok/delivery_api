import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'orders'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('client_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
            table.string('driver_id').nullable().references('id').inTable('users').onDelete('SET NULL')
            table.string('vehicle_id').nullable().references('id').inTable('vehicles').onDelete('SET NULL')

            table.string('ref_id').nullable()
            table.string('assignment_mode').defaultTo('GLOBAL')
            table.string('offered_driver_id').nullable().references('id').inTable('users').onDelete('SET NULL')
            table.timestamp('offer_expires_at').nullable()

            table.string('priority').defaultTo('MEDIUM')
            table.integer('assignment_attempt_count').defaultTo(0)
            table.string('status').notNullable().defaultTo('PENDING')

            table.boolean('is_complex').defaultTo(false)
            table.string('logic_pattern').nullable()
            table.boolean('is_deleted').defaultTo(false)

            table.jsonb('pricing_data').notNullable().defaultTo('{}')
            table.string('calculation_engine').nullable()
            table.integer('total_distance_meters').nullable()
            table.integer('total_duration_seconds').nullable()
            table.jsonb('route_geometry').nullable()
            table.jsonb('status_history').nullable().defaultTo('[]')
            table.jsonb('metadata').nullable().defaultTo('{}')

            table.timestamp('eta_pickup').nullable()
            table.timestamp('eta_delivery').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
