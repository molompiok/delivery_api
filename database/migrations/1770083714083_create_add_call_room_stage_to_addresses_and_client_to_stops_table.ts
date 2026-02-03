import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'add_call_room_stage_to_addresses_and_client_to_stops'

  async up() {
    this.schema.alterTable('addresses', (table) => {
      table.string('call').nullable()
      table.string('room').nullable()
      table.string('stage').nullable()
    })

    this.schema.alterTable('stops', (table) => {
      table.jsonb('client').nullable()
    })
  }

  async down() {
    this.schema.alterTable('addresses', (table) => {
      table.dropColumns('call', 'room', 'stage')
    })

    this.schema.alterTable('stops', (table) => {
      table.dropColumn('client')
    })
  }
}