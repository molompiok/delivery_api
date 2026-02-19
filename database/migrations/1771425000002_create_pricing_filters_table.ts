import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'pricing_filters'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()

            table.string('company_id').nullable().references('id').inTable('companies').onDelete('CASCADE')
            table.string('driver_id').nullable().references('id').inTable('users').onDelete('CASCADE')
            table.string('name').notNullable()

            // Base
            table.integer('base_fee').notNullable().defaultTo(500)

            // Distance
            table.integer('per_km_rate').notNullable().defaultTo(150)
            table.decimal('min_distance', 8, 2).notNullable().defaultTo(2)
            table.decimal('max_distance', 8, 2).nullable()

            // Charge (poids/volume)
            table.integer('per_kg_rate').notNullable().defaultTo(50)
            table.decimal('free_weight_kg', 8, 2).notNullable().defaultTo(5)
            table.integer('per_m3_rate').notNullable().defaultTo(0)

            // Surcharges (multiplicateurs)
            table.decimal('fragile_multiplier', 4, 2).notNullable().defaultTo(1.0)
            table.decimal('urgent_multiplier', 4, 2).notNullable().defaultTo(1.0)
            table.decimal('night_multiplier', 4, 2).notNullable().defaultTo(1.0)

            // Réductions inter-stops (proximité)
            table.decimal('proximity_discount_percent', 5, 2).notNullable().defaultTo(0)
            table.decimal('proximity_threshold_km', 8, 2).notNullable().defaultTo(2)

            // Charge excessive / légère
            table.decimal('heavy_load_surcharge_threshold_kg', 8, 2).notNullable().defaultTo(50)
            table.decimal('heavy_load_surcharge_percent', 5, 2).notNullable().defaultTo(0)
            table.decimal('light_load_discount_threshold_kg', 8, 2).notNullable().defaultTo(1)
            table.decimal('light_load_discount_percent', 5, 2).notNullable().defaultTo(0)

            table.boolean('is_default').notNullable().defaultTo(false)
            table.boolean('is_active').notNullable().defaultTo(true)

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()

            // Index
            table.index(['company_id'])
            table.index(['driver_id'])
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
