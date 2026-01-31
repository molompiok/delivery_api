import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    async up() {
        this.schema.createTable('zones', (table) => {
            table.string('id').primary().notNullable()
            table.string('name').notNullable()
            table.string('owner_type').notNullable() // User, Company, Sublymus
            table.string('owner_id').nullable()
            table.string('source_zone_id').nullable().references('id').inTable('zones').onDelete('SET NULL')
            table.string('color').nullable()
            table.string('sector').nullable()
            table.string('type').nullable() // circle, polygon, rectangle
            table.jsonb('geometry').notNullable() // Polygon or MultiPolygon
            table.boolean('is_active').defaultTo(true)

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        this.schema.createTable('action_zones', (table) => {
            table.string('id').primary().notNullable()
            table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
            table.double('center_lat').notNullable()
            table.double('center_lng').notNullable()
            table.double('radius_km').notNullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        this.schema.createTable('zone_drivers', (table) => {
            table.increments('id').primary().notNullable()
            table.string('zone_id').notNullable().references('id').inTable('zones').onDelete('CASCADE')
            table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable('zone_drivers')
        this.schema.dropTable('action_zones')
        this.schema.dropTable('zones')
    }
}
