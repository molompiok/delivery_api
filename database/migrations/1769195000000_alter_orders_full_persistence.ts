import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'orders'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            table.jsonb('route_geometry').nullable().comment('Full route geometry as GeoJSON LineString')
            table.jsonb('status_history').nullable().comment('Array of status changes with timestamps')
            table.jsonb('metadata').nullable().defaultTo('{}').comment('Flexible metadata storage')
            table.timestamp('eta_pickup').nullable()
            table.timestamp('eta_delivery').nullable()
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('route_geometry')
            table.dropColumn('status_history')
            table.dropColumn('metadata')
            table.dropColumn('eta_pickup')
            table.dropColumn('eta_delivery')
        })
    }
}
