import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'users'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('full_name').notNullable()
            table.string('email').nullable().unique()
            table.string('phone').nullable().unique().index()
            table.string('password').nullable()
            table.string('last_otp').nullable()
            table.timestamp('otp_expires_at').nullable()

            table.timestamp('last_login_at').nullable()
            table.timestamp('phone_verified_at').nullable()

            table.boolean('is_driver').defaultTo(false)
            table.boolean('is_admin').defaultTo(false)
            table.boolean('is_active').defaultTo(true)

            table.string('company_id').nullable() // References companies which we'll create next
            table.string('current_company_managed').nullable() // References companies which we'll create next

            table.string('fcm_token').nullable().index()

            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
