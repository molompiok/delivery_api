import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
    protected tableName = 'action_proofs'

    async up() {
        this.schema.createTable(this.tableName, (table) => {
            table.string('id').primary().notNullable()
            table.string('action_id').notNullable().references('id').inTable('actions').onDelete('CASCADE')

            // Type of proof: OTP, PHOTO, SIGNATURE, ID_CARD, etc.
            table.string('type').notNullable()

            // A unique key for this proof within the action (e.g. "pickup_photo", "recipient_otp")
            table.string('key').notNullable()

            // For OTP, this holds the generated code.
            table.string('expected_value').nullable()

            // For OTP, the code submitted. For PHOTO/SIGNATURE, the file_id or URL.
            table.string('submitted_value').nullable()

            table.boolean('is_verified').defaultTo(false)

            table.jsonb('metadata').defaultTo('{}')
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
        })
    }

    async down() {
        this.schema.dropTable(this.tableName)
    }
}
