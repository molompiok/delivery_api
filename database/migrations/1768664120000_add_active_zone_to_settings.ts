import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    async up() {
        // 1. Modifier la table zones pour permettre ownerType 'Sublymus' et ownerId nullable
        this.schema.alterTable('zones', (table) => {
            // Rendre ownerId nullable
            table.string('owner_id').nullable().alter()
            // Ajouter sourceZoneId pour tracer l'origine des zones copiées
            table.string('source_zone_id').nullable().references('id').inTable('zones').onDelete('SET NULL')
        })

        // 2. Ajouter activeZoneId à driver_settings
        this.schema.alterTable('driver_settings', (table) => {
            table.string('active_zone_id').nullable().references('id').inTable('zones').onDelete('SET NULL')
        })

        // 3. Ajouter activeZoneId à company_driver_settings
        this.schema.alterTable('company_driver_settings', (table) => {
            table.string('active_zone_id').nullable().references('id').inTable('zones').onDelete('SET NULL')
        })

        // NOTE: zone_drivers table is kept for the manyToMany relationship between User and Zone
        // activeZoneId is used to track the currently active zone, while zone_drivers stores all assigned zones
    }

    async down() {
        // Retirer activeZoneId de company_driver_settings
        this.schema.alterTable('company_driver_settings', (table) => {
            table.dropColumn('active_zone_id')
        })

        // Retirer activeZoneId de driver_settings
        this.schema.alterTable('driver_settings', (table) => {
            table.dropColumn('active_zone_id')
        })

        // Remettre ownerId non nullable
        this.schema.alterTable('zones', (table) => {
            table.string('owner_id').notNullable().alter()
        })
    }
}
