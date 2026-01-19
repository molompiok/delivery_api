import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'ratings'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('target_id').notNullable()
            table.string('target_type').notNullable()
            table.integer('score').notNullable()
            table.text('comment').nullable()
            table.string('author_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
