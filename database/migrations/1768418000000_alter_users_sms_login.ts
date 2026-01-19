import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'users'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.string('email', 254).nullable().alter()
            table.string('phone').unique().alter() // Ensure phone is unique for login
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.string('email', 254).notNullable().alter()
            table.dropUnique(['phone'])
        })
    }
}
