import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'companies'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('name').notNullable()
            table.string('owner_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

            table.string('registre_commerce').nullable()
            table.string('logo').nullable()
            table.text('description').nullable()
            table.string('tax_id').nullable()
            table.string('verification_status').defaultTo('PENDING')
            table.jsonb('settings').defaultTo('{}')
            table.jsonb('meta_data').defaultTo('{}')

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })

        // Now update users to reference companies
        this.schema.alterTable('users', (table) => {
            table.string('company_id').alter().references('id').inTable('companies').onDelete('SET NULL')
            table.string('current_company_managed').alter().references('id').inTable('companies').onDelete('SET NULL')
        })
    }

    async down() {
        // Need to drop reference first if possible or just drop table
        this.schema.dropTable(this.tableName)
    }
}
