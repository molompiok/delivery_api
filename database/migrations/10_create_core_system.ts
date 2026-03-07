import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    async up() {
        // 1. Steps
        this.schema.createTable('steps', (table) => {
            table.string('id').primary().notNullable()
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.integer('sequence').notNullable()
            table.boolean('linked').defaultTo(false)
            table.string('status').notNullable().defaultTo('PENDING')
            table.jsonb('metadata').defaultTo('{}')
            table.string('original_id').nullable().references('id').inTable('steps').onDelete('SET NULL')
            table.boolean('is_pending_change').defaultTo(false)
            table.boolean('is_delete_required').defaultTo(false)
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        // 2. Stops
        this.schema.createTable('stops', (table) => {
            table.string('id').primary().notNullable()
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.string('step_id').notNullable().references('id').inTable('steps').onDelete('CASCADE')
            table.string('address_id').notNullable().references('id').inTable('addresses')
            table.integer('display_order').notNullable()
            table.integer('execution_order').nullable().defaultTo(null)
            table.string('status').notNullable().defaultTo('PENDING')
            table.timestamp('arrival_time').nullable()
            table.timestamp('completion_time').nullable()
            table.jsonb('client').nullable()
            table.jsonb('metadata').defaultTo('{}')
            table.jsonb('status_history').nullable().defaultTo('[]')
            table.string('original_id').nullable().references('id').inTable('stops').onDelete('SET NULL')
            table.boolean('is_pending_change').defaultTo(false)
            table.boolean('is_delete_required').defaultTo(false)
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        // 3. Bookings (Needs Stops)
        this.schema.createTable('bookings', (table) => {
            table.string('id').primary()
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.string('client_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
            table.string('pickup_stop_id').nullable().references('id').inTable('stops').onDelete('SET NULL')
            table.string('dropoff_stop_id').nullable().references('id').inTable('stops').onDelete('SET NULL')
            table.json('seats_reserved').nullable()
            table.string('status').notNullable().defaultTo('PENDING')
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        // 4. Transit Items (Needs Orders and optionally Bookings)
        this.schema.createTable('transit_items', (table) => {
            table.string('id').primary().notNullable()
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.string('booking_id').nullable().references('id').inTable('bookings').onDelete('SET NULL')
            table.string('product_id').nullable()
            table.string('name').notNullable()
            table.string('description').nullable()
            table.string('packaging_type').defaultTo('box')
            table.float('weight').nullable()
            table.jsonb('dimensions').nullable()
            table.float('unitary_price').nullable()
            table.jsonb('metadata').defaultTo('{}')

            // Shadow columns
            table.string('original_id').nullable().references('id').inTable('transit_items').onDelete('SET NULL')
            table.boolean('is_pending_change').defaultTo(false)
            table.boolean('is_delete_required').defaultTo(false)

            // Client data
            table.string('client_name').nullable()
            table.string('client_phone').nullable()
            table.string('client_reference').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        // 5. Actions (Needs Stops and Transit Items)
        this.schema.createTable('actions', (table) => {
            table.string('id').primary().notNullable()
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.string('stop_id').notNullable().references('id').inTable('stops').onDelete('CASCADE')
            table.string('transit_item_id').nullable().references('id').inTable('transit_items').onDelete('SET NULL')
            table.string('type').notNullable()
            table.float('quantity').defaultTo(1)
            table.string('status').notNullable().defaultTo('PENDING')
            table.integer('service_time').defaultTo(300)
            table.jsonb('confirmation_rules').defaultTo('{}')
            table.jsonb('metadata').defaultTo('{}')
            table.jsonb('status_history').nullable().defaultTo('[]')
            table.string('original_id').nullable().references('id').inTable('actions').onDelete('SET NULL')
            table.boolean('is_pending_change').defaultTo(false)
            table.boolean('is_delete_required').defaultTo(false)
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable('actions')
        this.schema.dropTable('transit_items')
        this.schema.dropTable('bookings')
        this.schema.dropTable('stops')
        this.schema.dropTable('steps')
    }
}
