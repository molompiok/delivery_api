import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'payment_intents'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()
      table.string('order_id').notNullable().references('id').inTable('orders').onDelete('CASCADE')
      table.string('booking_id').nullable().references('id').inTable('bookings').onDelete('CASCADE')
      table.string('stop_id').nullable().references('id').inTable('stops').onDelete('CASCADE')
      table.string('payer_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      table.float('amount').notNullable()
      table.float('calculated_amount').notNullable()
      table.boolean('is_price_overridden').notNullable().defaultTo(false)

      table.string('payment_method').notNullable().defaultTo('CASH') // CASH, WAVE, WALLET
      table.string('status').notNullable().defaultTo('PENDING') // PENDING, COMPLETED, FAILED, REFUNDED
      table.string('external_id').nullable() // ID from Wave API or other gateway

      // Split breakdown (remplace la table payment_splits)
      table.float('platform_fee').notNullable().defaultTo(0)
      table.float('wave_fee').notNullable().defaultTo(0)
      table.float('company_amount').notNullable().defaultTo(0)
      table.float('driver_amount').notNullable().defaultTo(0)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // Index pour les recherches fréquentes par FK
      table.index(['order_id'])
      table.index(['booking_id'])
      table.index(['stop_id'])
      table.index(['payer_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}