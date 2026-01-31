import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Company from '#models/company'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class Product extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(product: Product) {
        product.id = generateId('prd')
    }

    /**
     * ID de l'entreprise propriétaire du produit
     */
    @column()
    declare companyId: string

    @column()
    declare name: string

    @column()
    declare description: string | null

    /**
     * Stock Keeping Unit - Identifiant SKU unique pour l'entreprise
     */
    @column()
    declare sku: string | null

    /**
     * Dimensions par défaut (poids, hauteur, largeur, profondeur, volume)
     */
    @column({
        prepare: (v) => v ? JSON.stringify(v) : null,
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare dimensions: any

    @column()
    declare weight: number | null

    /**
     * Type de conditionnement (box | fluid)
     */
    @column()
    declare packagingType: 'box' | 'fluid'

    @column()
    declare category: string | null

    @column({
        prepare: (v) => v ? JSON.stringify(v) : JSON.stringify({}),
        consume: (v) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare metadata: any

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => Company)
    declare company: BelongsTo<typeof Company>
}
