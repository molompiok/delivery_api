import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'security_logs'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('user_id').nullable().references('id').inTable('users').onDelete('SET NULL')
            table.string('event_type').notNullable()
            table.string('ip_address').nullable()
            table.text('user_agent').nullable()
            table.jsonb('metadata').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
