import { DateTime } from 'luxon'
import { BaseModel, beforeCreate, column, belongsTo, hasMany, hasOne } from '@adonisjs/lucid/orm'
import { generateId } from '../utils/id_generator.js'
import Order from '#models/order'
import PaymentPolicy from '#models/payment_policy'
import StopPayment from '#models/stop_payment'
import CodCollection from '#models/cod_collection'
import type { BelongsTo, HasMany, HasOne } from '@adonisjs/lucid/types/relations'

export type OrderPaymentStatus =
    | 'PENDING'
    | 'AUTHORIZED'
    | 'PARTIAL'
    | 'COMPLETED'
    | 'FAILED'
    | 'REFUNDED'
    | 'COD_PENDING'
    | 'COD_COLLECTED'
    | 'COD_DEFERRED'

export type CodStatus = 'NONE' | 'PENDING' | 'COLLECTED' | 'DEPOSITED'

export default class OrderPayment extends BaseModel {

    @column({ isPrimary: true })
    declare id: string

    @beforeCreate()
    static assignId(payment: OrderPayment) {
        payment.id = generateId('opay')
    }

    @column()
    declare orderId: string

    @column()
    declare paymentPolicyId: string | null

    // Montants calculés
    @column()
    declare totalAmount: number

    @column()
    declare driverAmount: number

    @column()
    declare companyAmount: number

    @column()
    declare platformAmount: number

    // Wallets impliqués
    @column()
    declare clientWalletId: string | null

    @column()
    declare driverWalletId: string | null

    @column()
    declare companyWalletId: string | null

    @column()
    declare platformWalletId: string | null

    // Statut
    @column()
    declare paymentStatus: OrderPaymentStatus

    // Références wave-api
    @column()
    declare paymentIntentId: string | null

    @column()
    declare internalPaymentIntentId: string | null

    // Progressif
    @column()
    declare paidAmount: number

    @column()
    declare remainingAmount: number

    // COD
    @column()
    declare codAmount: number | null

    @column()
    declare codStatus: CodStatus | null

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime | null

    @belongsTo(() => Order)
    declare order: BelongsTo<typeof Order>

    @belongsTo(() => PaymentPolicy)
    declare paymentPolicy: BelongsTo<typeof PaymentPolicy>

    @hasMany(() => StopPayment)
    declare stopPayments: HasMany<typeof StopPayment>

    @hasOne(() => CodCollection)
    declare codCollection: HasOne<typeof CodCollection>
}
