import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'users'

    async up() {
        this.schema.raw('ALTER TABLE users ALTER COLUMN full_name DROP DEFAULT')
        this.schema.raw(`
            UPDATE users
            SET full_name = NULL
            WHERE full_name IS NOT NULL
              AND lower(trim(full_name)) IN (
                'ajouter un nom',
                'add a name',
                'add name',
                'nom complet',
                'full name'
              )
        `)
    }

    async down() {
        this.schema.raw(`ALTER TABLE users ALTER COLUMN full_name SET DEFAULT 'Ajouter un nom'`)
    }
}
