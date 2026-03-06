import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import Step from '#models/step'
import Booking from '#models/booking'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Action from './action.js'
import Product from './product.js'

export default class TransitItem extends BaseModel {
    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(item: TransitItem) {
        if (!item.id) {
            item.id = generateId('tri')
        }
    }

    /**
     * ID de la commande à laquelle appartient cet item
     */
    @column()
    declare orderId: string

    /**
     * Lien optionnel vers le catalogue de produits
     */
    @column()
    declare productId: string | null

    @column()
    declare name: string

    @column()
    declare description: string | null

    @column()
    declare unitaryPrice: number | null

    /**
     * Poids et dimensions spécifiques à cette instance en transit
     */
    @column()
    declare weight: number | null

    @column({
        prepare: (v: any) => v ? JSON.stringify(v) : null,
        consume: (v: any) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare dimensions: any

    @column()
    declare packagingType: 'box' | 'fluid' | 'person'

    @column({
        prepare: (v: any) => v ? JSON.stringify(v) : JSON.stringify({}),
        consume: (v: any) => typeof v === 'string' ? JSON.parse(v) : v
    })
    declare metadata: any

    @column()
    declare clientName: string | null

    @column()
    declare clientPhone: string | null

    @column()
    declare clientReference: string | null

    @column()
    declare originalId: string | null

    @column()
    declare isPendingChange: boolean

    @column()
    declare isDeleteRequired: boolean

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => Order)
    declare order: BelongsTo<typeof Order>

    @column()
    declare bookingId: string | null

    @belongsTo(() => Booking)
    declare booking: BelongsTo<typeof Booking>

    @column()
    declare pickupStepId: string | null

    @belongsTo(() => Step)
    declare pickupStep: BelongsTo<typeof Step>

    @column()
    declare deliveryStepId: string | null

    @belongsTo(() => Step)
    declare deliveryStep: BelongsTo<typeof Step>

    @belongsTo(() => Product)
    declare product: BelongsTo<typeof Product>

    /**
     * Actions liées à cet item (collectes et livraisons)
     */
    @hasMany(() => Action, { foreignKey: 'transitItemId' })
    declare actions: HasMany<typeof Action>

    /**
     * PROPRIÉTÉS CALCULÉES (Getters)
     */

    /**
     * Quantité totale récupérée (somme des actions 'pickup +')
     */
    public get pickupQuantity(): number {
        return this.actions
            ?.filter(a => a.type === 'PICKUP' && a.status === 'COMPLETED')
            .reduce((sum, a) => sum + (a.quantity || 0), 0) || 0
    }

    /**
     * Quantité totale livrée (somme des actions 'delivery -')
     */
    public get deliveredQuantity(): number {
        return this.actions
            ?.filter(a => a.type === 'DELIVERY' && a.status === 'COMPLETED')
            .reduce((sum, a) => sum + (a.quantity || 0), 0) || 0
    }

    /**
     * Quantité actuellement dans le véhicule
     */
    public get currentQuantity(): number {
        return this.pickupQuantity - this.deliveredQuantity
    }
}
