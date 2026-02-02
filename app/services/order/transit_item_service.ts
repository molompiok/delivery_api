import db from '@adonisjs/lucid/services/db'
import TransitItem from '#models/transit_item'
import Order from '#models/order'
import { LogisticsOperationResult } from '../../types/logistics.js'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { transitItemSchema } from '../../validators/order_validator.js'
import vine from '@vinejs/vine'
import { inject } from '@adonisjs/core'

@inject()
export default class TransitItemService {
    /**
     * Adds a transit item to an order.
     */
    async addTransitItem(orderId: string, clientId: string, data: any, trx?: TransactionClientContract): Promise<LogisticsOperationResult<TransitItem>> {
        const validatedData = await vine.validate({ schema: transitItemSchema, data })
        const effectiveTrx = trx || await db.transaction()
        try {
            const order = await Order.query({ client: effectiveTrx }).where('id', orderId).where('clientId', clientId).firstOrFail()

            const ti = await TransitItem.create({
                orderId: order.id,
                productId: validatedData.product_id,
                name: validatedData.name,
                description: validatedData.description,
                packagingType: validatedData.packaging_type || 'box',
                weight: validatedData.weight_g ?? null,
                dimensions: validatedData.dimensions,
                unitaryPrice: validatedData.unitary_price,
                metadata: validatedData.metadata || {},
            }, { client: effectiveTrx })

            if (!trx) await (effectiveTrx as any).commit()

            return {
                entity: ti,
                validationErrors: []
            }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }

    /**
     * Updates a transit item.
     */
    async updateTransitItem(itemId: string, clientId: string, data: any, trx?: TransactionClientContract): Promise<LogisticsOperationResult<TransitItem>> {
        const validatedData = await vine.validate({ schema: transitItemSchema, data })
        const effectiveTrx = trx || await db.transaction()
        try {
            const ti = await TransitItem.query({ client: effectiveTrx }).where('id', itemId).firstOrFail()
            await Order.query({ client: effectiveTrx }).where('id', ti.orderId).where('clientId', clientId).firstOrFail()

            ti.merge({
                productId: validatedData.product_id,
                name: validatedData.name,
                description: validatedData.description,
                packagingType: validatedData.packaging_type || 'box',
                weight: validatedData.weight_g ?? null,
                dimensions: validatedData.dimensions,
                unitaryPrice: validatedData.unitary_price,
                metadata: {
                    ...(ti.metadata || {}),
                    ...validatedData.metadata,
                    volumeL: validatedData.dimensions?.volume_l || null,
                    requirements: validatedData.requirements || [],
                }
            })

            await ti.useTransaction(effectiveTrx).save()

            if (!trx) await (effectiveTrx as any).commit()

            return {
                entity: ti,
                validationErrors: []
            }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }

    /**
     * Bulk creates transit items and returns a mapping from input ID to real UUID.
     */
    async createBulk(orderId: string, transitItems: any[], trx: TransactionClientContract): Promise<Map<string, TransitItem>> {
        const transitItemsMap = new Map<string, TransitItem>()

        for (const itemData of transitItems) {
            const ti = await TransitItem.create({
                orderId: orderId,
                productId: itemData.product_id,
                name: itemData.name,
                description: itemData.description,
                packagingType: itemData.packaging_type || 'box',
                weight: itemData.weight_g ?? null,
                dimensions: itemData.dimensions,
                unitaryPrice: itemData.unitary_price,
                metadata: {
                    ...itemData.metadata,
                    volumeL: itemData.dimensions?.volume_l || null,
                    requirements: itemData.requirements || [],
                }
            }, { client: trx })

            transitItemsMap.set(itemData.id, ti)
        }

        return transitItemsMap
    }

    /**
     * Removes a transit item.
     */
    async removeTransitItem(itemId: string, clientId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()

        try {
            const ti = await TransitItem.query({ client: effectiveTrx }).where('id', itemId).first()
            if (!ti) throw new Error('Transit item not found')

            await Order.query({ client: effectiveTrx }).where('id', ti.orderId).where('clientId', clientId).firstOrFail()

            await ti.useTransaction(effectiveTrx).delete()
            if (!trx) await (effectiveTrx as any).commit()
            return { success: true }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }
}
