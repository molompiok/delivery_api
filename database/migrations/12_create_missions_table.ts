import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'missions'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.string('driver_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

            table.string('status').notNullable().defaultTo('PENDING')
            table.timestamp('start_at').nullable()
            table.timestamp('completed_at').nullable()

            table.jsonb('optimized_data').nullable()
            table.integer('estimated_duration').nullable()
            table.integer('estimated_distance').nullable()
            table.jsonb('route_geometry').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
