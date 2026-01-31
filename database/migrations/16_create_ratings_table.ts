import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'ratings'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
            table.string('from_id').notNullable()
            table.string('to_id').notNullable()

            table.integer('score').notNullable()
            table.text('comment').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
