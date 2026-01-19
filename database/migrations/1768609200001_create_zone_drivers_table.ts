import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'zone_drivers'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.increments('id')
            table.string('zone_id').notNullable().references('id').inTable('zones').onDelete('CASCADE')
            table.string('driver_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
            table.unique(['zone_id', 'driver_id'])
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
