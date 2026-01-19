import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'api_keys'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
            table.string('name').notNullable()
            table.string('key_hash').notNullable()
            table.string('hint').notNullable()
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
