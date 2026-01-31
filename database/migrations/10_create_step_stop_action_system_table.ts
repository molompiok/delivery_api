import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    async up() {
        // 1. Transit Items
        this.schema.createTable('transit_items', (table) => {
            table.string('id').primary().notNullable()
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.string('product_id').nullable() // We'll create products table separately
            table.string('name').notNullable()
            table.string('description').nullable()
            table.string('packaging_type').defaultTo('box')
            table.float('weight').nullable()
            table.integer('quantity').defaultTo(1)
            table.jsonb('dimensions').nullable()
            table.string('mention_warning').nullable()
            table.float('unitary_price').nullable()
            table.jsonb('metadata').defaultTo('{}')
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        // 2. Steps
        this.schema.createTable('steps', (table) => {
            table.string('id').primary().notNullable()
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.integer('sequence').notNullable()
            table.boolean('linked').defaultTo(false)
            table.string('status').notNullable().defaultTo('PENDING')
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        // 3. Stops
        this.schema.createTable('stops', (table) => {
            table.string('id').primary().notNullable()
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.string('step_id').notNullable().references('id').inTable('steps').onDelete('CASCADE')
            table.string('address_id').notNullable().references('id').inTable('addresses')
            table.integer('sequence').notNullable()
            table.string('status').notNullable().defaultTo('PENDING')
            table.timestamp('arrival_time').nullable()
            table.timestamp('completion_time').nullable()
            table.jsonb('metadata').defaultTo('{}')
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        // 4. Actions
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
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable('actions')
        this.schema.dropTable('stops')
        this.schema.dropTable('steps')
        this.schema.dropTable('transit_items')
    }
}
