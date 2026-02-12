import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'driver_location_histories'

  public async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      table.decimal('lat', 10, 8).notNullable()
      table.decimal('lng', 11, 8).notNullable()
      table.decimal('heading', 5, 2).nullable()

      table.timestamp('timestamp', { useTz: true }).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
    })
  }

  public async down() {
    this.schema.dropTable(this.tableName)
  }
}