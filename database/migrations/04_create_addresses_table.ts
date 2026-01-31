import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'addresses'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('owner_type').notNullable() // User, Company, Order, etc.
            table.string('owner_id').notNullable()

            table.string('label').nullable()
            table.string('formatted_address').notNullable()
            table.string('street').nullable()
            table.string('city').nullable()
            table.double('lat').notNullable()
            table.double('lng').notNullable()
            table.string('zip_code').nullable()
            table.string('country').nullable().defaultTo('Côte d\'Ivoire')

            table.boolean('is_active').defaultTo(true)
            table.boolean('is_default').defaultTo(false)

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
