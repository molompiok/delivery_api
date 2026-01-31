import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'api_keys'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('name').notNullable()
            table.string('key').unique().notNullable()
            table.string('owner_type').notNullable()
            table.string('owner_id').notNullable()

            table.timestamp('last_used_at').nullable()
            table.timestamp('expires_at').nullable()
            table.boolean('is_active').defaultTo(true)

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
