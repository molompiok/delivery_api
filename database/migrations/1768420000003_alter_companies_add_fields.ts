import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'companies'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.string('registre_commerce').nullable()
            table.string('logo').nullable()
            table.text('description').nullable()
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('registre_commerce')
            table.dropColumn('logo')
            table.dropColumn('description')
        })
    }
}
