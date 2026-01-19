import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'async_confirms'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.string('user_id').nullable().alter()
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            // Be careful: this might fail if there are null values.
            // In a real scenario, we might want to delete or fix them first.
            // For now, we'll try to revert it.
            table.string('user_id').notNullable().alter()
        })
    }
}
