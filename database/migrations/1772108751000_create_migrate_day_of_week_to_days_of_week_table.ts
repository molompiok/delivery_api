import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'schedules'

    async up() {
        this.schema.alterTable(this.tableName, (table) => {
            // Add new JSON column for multiple days
            table.json('days_of_week').nullable()
        })

        // Migrate existing data: convert single integer to JSON array
        this.defer(async (db) => {
            const rows = await db.from(this.tableName).whereNotNull('day_of_week')
            for (const row of rows) {
                await db.from(this.tableName)
                    .where('id', row.id)
                    .update({ days_of_week: JSON.stringify([row.day_of_week]) })
            }
        })

        // Drop old column after migration
        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('day_of_week')
        })
    }

    async down() {
        this.schema.alterTable(this.tableName, (table) => {
            table.integer('day_of_week').nullable()
        })

        this.defer(async (db) => {
            const rows = await db.from(this.tableName).whereNotNull('days_of_week')
            for (const row of rows) {
                const days = typeof row.days_of_week === 'string'
                    ? JSON.parse(row.days_of_week)
                    : row.days_of_week
                if (Array.isArray(days) && days.length > 0) {
                    await db.from(this.tableName)
                        .where('id', row.id)
                        .update({ day_of_week: days[0] })
                }
            }
        })

        this.schema.alterTable(this.tableName, (table) => {
            table.dropColumn('days_of_week')
        })
    }
}
