import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'documents'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary()
            table.string('document_type').notNullable()
            table.string('file_id').nullable().references('id').inTable('files').onDelete('SET NULL')

            // Polymorphic link
            table.string('table_name').notNullable()
            table.string('table_id').notNullable()

            table.string('status').notNullable().defaultTo('PENDING')

            // Ownership
            table.string('owner_id').notNullable()
            table.string('owner_type').notNullable()

            table.jsonb('metadata').notNullable().defaultTo('{}')
            table.text('validation_comment').nullable()
            table.timestamp('expire_at').nullable()

            table.timestamp('created_at', { useTz: true }).notNullable()
            table.timestamp('updated_at', { useTz: true }).nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
