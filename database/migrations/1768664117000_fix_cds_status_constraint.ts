import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'company_driver_settings'

    async up() {
        this.schema.raw(`ALTER TABLE ${this.tableName} DROP CONSTRAINT IF EXISTS company_driver_settings_status_check`)

        this.schema.alterTable(this.tableName, (table) => {
            table.string('status', 50).notNullable().alter()
        })
    }

    async down() {
        // No safe way to restore the specific enum constraint without knowing exact previous state
    }
}
