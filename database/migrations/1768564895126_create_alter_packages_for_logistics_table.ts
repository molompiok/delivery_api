import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'packages'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('name').nullable()
      table.text('description').nullable()
      table.jsonb('dimensions_json').nullable() // { weight_g, depth_cm, width_cm, height_cm }
      table.integer('quantity').defaultTo(1)
      table.string('mention_warning').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('name')
      table.dropColumn('description')
      table.dropColumn('dimensions_json')
      table.dropColumn('quantity')
      table.dropColumn('mention_warning')
    })
  }
}