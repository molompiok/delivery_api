import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'company_driver_settings'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.jsonb('required_doc_types').nullable().defaultTo('[]')
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('required_doc_types')
        })
    }
}
