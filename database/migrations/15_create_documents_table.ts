import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'documents'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('document_type').notNullable()
            table.string('file_id').nullable().references('id').inTable('files').onDelete('SET NULL')

            table.string('table_name').notNullable()
            table.string('table_id').notNullable()

            table.string('status').notNullable().defaultTo('PENDING')
            table.string('owner_id').notNullable()
            table.string('owner_type').notNullable() // User, Company

            table.jsonb('metadata').defaultTo('{}')
            table.text('validation_comment').nullable()
            table.boolean('is_deleted').defaultTo(false)
            table.timestamp('expire_at').nullable()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
