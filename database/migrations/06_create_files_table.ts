import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'files'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('path').notNullable()
            table.string('name').notNullable()
            table.string('table_name').notNullable()
            table.string('table_column').notNullable()
            table.string('table_id').notNullable()

            table.string('mime_type').nullable()
            table.integer('size').nullable()
            table.boolean('is_encrypted').defaultTo(false)
            table.string('file_category').nullable()
            table.jsonb('metadata').nullable().defaultTo('{}')

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        this.schema.createTable('file_permissions', (table) => {
            table.string('id').primary().notNullable()
            table.string('table_name').notNullable()
            table.string('table_column').notNullable()
            table.string('table_id').notNullable()
            table.string('owner_id').notNullable()
            table.jsonb('read_access').notNullable().defaultTo('{"userIds": [], "companyIds": []}')
            table.jsonb('write_access').notNullable().defaultTo('{"userIds": [], "companyIds": []}')
            table.jsonb('config').nullable().defaultTo('{}')
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        this.schema.createTable('file_contents', (table) => {
            table.string('id').primary().notNullable()
            table.string('file_id').notNullable().references('id').inTable('files').onDelete('CASCADE')
            table.binary('content').notNullable()
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable('file_contents')
        this.schema.dropTable('file_permissions')
        this.schema.dropTable(this.tableName)
    }
}
