import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'async_confirms'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('user_id').nullable().references('id').inTable('users').onDelete('CASCADE')
            table.string('token_hash').notNullable()
            table.string('type').notNullable()
            table.string('phone_number').nullable()
            table.string('code').nullable()
            table.jsonb('payload').nullable().defaultTo('{}')
            table.timestamp('expires_at').notNullable()
            table.boolean('is_verified').defaultTo(false)
            table.timestamp('used_at').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
