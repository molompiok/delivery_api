import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'files'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.string('mime_type').nullable()
            table.bigInteger('size').nullable()
            table.boolean('is_encrypted').defaultTo(false)
            table.enum('file_category', ['IMAGE', 'VIDEO', 'DOCS', 'BINARY', 'JSON', 'OTHER']).defaultTo('OTHER')
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('mime_type')
            table.dropColumn('size')
            table.dropColumn('is_encrypted')
            table.dropColumn('file_category')
        })
    }
}
