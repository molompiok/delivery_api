import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'users'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.string('password').nullable().alter()
            table.timestamp('last_login_at').nullable()
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.string('password').notNullable().alter()
            table.dropColumn('last_login_at')
        })
    }
}
