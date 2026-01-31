import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'products'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('company_id').notNullable().references('id').inTable('companies').onDelete('CASCADE')

            table.string('name').notNullable()
            table.text('description').nullable()
            table.string('sku').nullable()
            table.string('packaging_type').defaultTo('box')

            table.float('weight').nullable()
            table.json('dimensions').nullable()
            table.jsonb('metadata').defaultTo('{}')

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
