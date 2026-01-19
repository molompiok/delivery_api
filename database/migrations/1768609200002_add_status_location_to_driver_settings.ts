import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'driver_settings'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.string('status').defaultTo('OFFLINE')
            table.double('current_lat').nullable()
            table.double('current_lng').nullable()
            table.float('mileage').defaultTo(0)
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('status')
            table.dropColumn('current_lat')
            table.dropColumn('current_lng')
            table.dropColumn('mileage')
        })
    }
}
