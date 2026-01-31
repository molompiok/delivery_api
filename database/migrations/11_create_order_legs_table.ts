import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'order_legs'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.integer('sequence').notNullable()

            table.string('start_address_id').nullable().references('id').inTable('addresses').onDelete('SET NULL')
            table.string('end_address_id').nullable().references('id').inTable('addresses').onDelete('SET NULL')

            table.jsonb('start_coordinates').nullable()
            table.jsonb('end_coordinates').nullable()
            table.jsonb('geometry').nullable()

            table.integer('duration_seconds').nullable()
            table.integer('distance_meters').nullable()
            table.jsonb('maneuvers').nullable()
            table.jsonb('raw_data').nullable()

            table.string('status').notNullable().defaultTo('PLANNED')
            table.jsonb('status_history').nullable().defaultTo('[]')
            table.jsonb('actual_path').nullable()
            table.string('verification_code').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
