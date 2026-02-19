import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, beforeCreate, beforeSave, column, belongsTo, hasMany, manyToMany, hasOne } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import { generateId } from '../utils/id_generator.js'
import type { BelongsTo, HasMany, ManyToMany, HasOne } from '@adonisjs/lucid/types/relations'
import Company from '#models/company'
import Schedule from '#models/schedule'
import ApiKey from '#models/api_key'
import Zone from '#models/zone'
import DriverSetting from '#models/driver_setting'
import Document from '#models/document'
import { computed } from '@adonisjs/lucid/orm'
import FileManager from '#services/file_manager'


const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],
  passwordColumnName: 'password',
})

//@ts-ignore
export default class User extends compose(BaseModel, AuthFinder) {
  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(user: User) {
    user.id = generateId('usr')
  }

  @beforeSave()
  static async hashPassword(user: User) {
    if (user.$dirty.password && user.password && !user.password.startsWith('$scrypt$')) {
      user.password = await hash.make(user.password)
    }
  }

  @column()
  declare fullName: string | null

  @column()
  declare email: string | null

  @column({ serializeAs: null })
  declare password: string | null

  @column.dateTime()
  declare lastLoginAt: DateTime | null

  @column()
  declare phone: string | null

  @column.dateTime()
  declare phoneVerifiedAt: DateTime | null

  @column()
  declare isDriver: boolean

  @column()
  declare isAdmin: boolean

  @column()
  declare isActive: boolean

  @column()
  declare companyId: string | null

  @column()
  declare currentCompanyManaged: string | null

  @column()
  declare fcmToken: string | null

  @column()
  declare walletId: string | null

  @belongsTo(() => Company)
  declare company: BelongsTo<typeof Company>

  @hasMany(() => Schedule)
  declare schedules: HasMany<typeof Schedule>



  @hasMany(() => ApiKey)
  declare apiKeys: HasMany<typeof ApiKey>

  @manyToMany(() => Zone, {
    pivotTable: 'zone_drivers',
    pivotForeignKey: 'user_id',
    pivotRelatedForeignKey: 'zone_id',
    pivotTimestamps: true,
  })
  declare zones: ManyToMany<typeof Zone>

  @hasOne(() => DriverSetting)
  declare driverSetting: HasOne<typeof DriverSetting>

  @hasMany(() => Document, {
    foreignKey: 'tableId',
    onQuery: (query) => query.where('tableName', 'User').where('isDeleted', false),
  })
  declare documents: HasMany<typeof Document>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // --- VIRTUAL FILE COLUMNS ---

  @computed()
  get photos() {
    return (this.$extras.photos || []).map((name: string) => `fs/${name}`)
  }

  @computed()
  get addressPhotos() {
    return (this.$extras.address_photos || []).map((name: string) => `fs/${name}`)
  }

  @computed()
  get effectiveCompanyId() {
    return this.currentCompanyManaged || this.companyId
  }

  /**
   * Helper to load files into extras
   */
  async loadFiles() {
    this.$extras.photos = await FileManager.getPathsFor('User', this.id, 'photos')
    this.$extras.address_photos = await FileManager.getPathsFor('User', this.id, 'address_photos')
  }

  static accessTokens = DbAccessTokensProvider.forModel(User)
}