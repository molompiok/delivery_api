import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'files'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            // Public access - anyone can view/download
            table.boolean('is_public').defaultTo(false)

            // Allowed specific user IDs (JSON array of user IDs)
            table.jsonb('allowed_user_ids').defaultTo('[]')

            // Allowed company IDs - managers of these companies can access (JSON array)
            table.jsonb('allowed_company_ids').defaultTo('[]')
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('is_public')
            table.dropColumn('allowed_user_ids')
            table.dropColumn('allowed_company_ids')
        })
    }
}
