import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    async up() {
        // Add activeVehicleId to driver_settings (IDEP mode)
        this.schema.alterTable('driver_settings', (table) => {
            table.string('active_vehicle_id').nullable().references('id').inTable('vehicles').onDelete('SET NULL')
        })

        // Add activeVehicleId to company_driver_settings (ETP mode)
        this.schema.alterTable('company_driver_settings', (table) => {
            table.string('active_vehicle_id').nullable().references('id').inTable('vehicles').onDelete('SET NULL')
        })
    }

    async down() {
        this.schema.alterTable('driver_settings', (table) => {
            table.dropColumn('active_vehicle_id')
        })

        this.schema.alterTable('company_driver_settings', (table) => {
            table.dropColumn('active_vehicle_id')
        })
    }
}
