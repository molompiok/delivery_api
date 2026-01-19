import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'driver_settings'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            // Mode de travail actuel du driver (IDEP, ETP, ou en transition)
            table.string('current_mode').notNullable().defaultTo('IDEP')
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('current_mode')
        })
    }
}
