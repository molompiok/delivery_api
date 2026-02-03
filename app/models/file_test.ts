import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, computed } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import FileManager from '#services/file_manager'

export default class FileTest extends BaseModel {
  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(model: FileTest) {
    if (!model.id) {
      model.id = generateId('tst')
    }
  }

  @column()
  declare name: string

  @column()
  declare userId: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @computed()
  get avatar() {
    return (this.$extras.avatar || []).map((name: string) => `fs/${name}`)
  }

  @computed()
  get documents() {
    return (this.$extras.documents || []).map((name: string) => `fs/${name}`)
  }

  async loadFiles() {
    this.$extras.avatar = await FileManager.getPathsFor('FileTest', this.id, 'avatar')
    this.$extras.documents = await FileManager.getPathsFor('FileTest', this.id, 'documents')
  }
}