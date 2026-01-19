import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'zones'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('owner_type').notNullable() // Company or User
            table.string('owner_id').notNullable()
            table.string('name').notNullable()
            table.string('color').notNullable().defaultTo('#10b981')
            table.string('sector').nullable()
            table.string('type').notNullable() // circle, polygon, rectangle
            table.json('geometry').notNullable() // Stores center, radius, paths, bounds based on type
            table.boolean('is_active').notNullable().defaultTo(true)

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
