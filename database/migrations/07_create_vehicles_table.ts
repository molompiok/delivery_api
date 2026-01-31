import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'vehicles'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('brand').notNullable()
            table.string('model').notNullable()
            table.string('plate').notNullable().unique()

            table.string('type').notNullable() // MOTO, CAR_SEDAN, etc.
            table.string('energy').notNullable()
            table.string('color').nullable()
            table.integer('year').nullable()
            table.json('specs').nullable()

            table.string('owner_type').notNullable() // User, Company
            table.string('owner_id').notNullable()
            table.string('company_id').nullable().references('id').inTable('companies').onDelete('CASCADE')
            table.string('assigned_driver_id').nullable().references('id').inTable('users').onDelete('SET NULL')

            table.string('verification_status').defaultTo('PENDING')
            table.jsonb('metadata').defaultTo('{}')

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
