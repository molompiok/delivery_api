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
    async findTransitItem(itemId: string, trx?: TransactionClientContract): Promise<TransitItem | null> {
        return TransitItem.query({ client: trx }).where('id', itemId).first()
    }

    /**
     * Adds a transit item to an order.
     */
    async addTransitItem(orderId: string, clientId: string, data: any, trx?: TransactionClientContract): Promise<LogisticsOperationResult<TransitItem>> {
        const validatedData = await vine.validate({ schema: transitItemSchema, data })
        const effectiveTrx = trx || await db.transaction()
        try {
            const order = await Order.query({ client: effectiveTrx }).where('id', orderId).where('clientId', clientId).firstOrFail()
            const isDraft = order.status === 'DRAFT'

            const ti = await TransitItem.create({
                orderId: order.id,
                productId: validatedData.product_id,
                name: validatedData.name,
                description: validatedData.description,
                packagingType: validatedData.packaging_type || 'box',
                weight: validatedData.weight ?? null,
                dimensions: validatedData.dimensions,
                unitaryPrice: validatedData.unitary_price,
                metadata: validatedData.metadata || {},
                isPendingChange: !isDraft,
            }, { client: effectiveTrx })

            if (!isDraft) {
                order.hasPendingChanges = true
                await order.useTransaction(effectiveTrx).save()
            }

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
            const ti = await TransitItem.query({ client: effectiveTrx }).where('id', itemId).first()
            if (!ti) return { entity: null as any, validationErrors: [] }

            const order = await Order.query({ client: effectiveTrx }).where('id', ti.orderId).where('clientId', clientId).firstOrFail()
            const isDraft = order.status === 'DRAFT'

            let targetTi = ti
            if (!isDraft && !ti.isPendingChange) {
                // Check for existing shadow
                const existingShadow = await TransitItem.query({ client: effectiveTrx })
                    .where('originalId', ti.id)
                    .where('isPendingChange', true)
                    .first()

                if (existingShadow) {
                    targetTi = existingShadow
                } else {
                    // Create shadow clone
                    targetTi = await TransitItem.create({
                        orderId: ti.orderId,
                        productId: ti.productId,
                        name: ti.name,
                        description: ti.description,
                        packagingType: ti.packagingType,
                        weight: ti.weight,
                        dimensions: ti.dimensions,
                        unitaryPrice: ti.unitaryPrice,
                        metadata: ti.metadata,
                        originalId: ti.id,
                        isPendingChange: true
                    }, { client: effectiveTrx })
                }
            }

            if (validatedData.product_id !== undefined) targetTi.productId = validatedData.product_id
            if (validatedData.name !== undefined) targetTi.name = validatedData.name
            if (validatedData.description !== undefined) targetTi.description = validatedData.description
            if (validatedData.packaging_type !== undefined) targetTi.packagingType = validatedData.packaging_type
            if (validatedData.weight !== undefined) targetTi.weight = validatedData.weight
            if (validatedData.unitary_price !== undefined) targetTi.unitaryPrice = validatedData.unitary_price

            if (validatedData.dimensions !== undefined) {
                targetTi.dimensions = {
                    ...(targetTi.dimensions || {}),
                    ...(validatedData.dimensions || {})
                }
            }

            if (validatedData.metadata !== undefined) {
                targetTi.metadata = {
                    ...(targetTi.metadata || {}),
                    ...(validatedData.metadata || {}),
                }
            }

            await targetTi.useTransaction(effectiveTrx).save()

            if (!isDraft) {
                order.hasPendingChanges = true
                await order.useTransaction(effectiveTrx).save()
            }

            if (!trx) await (effectiveTrx as any).commit()

            return {
                entity: targetTi,
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
                id: itemData.id, // Use pre-generated ID if available
                orderId: orderId,
                productId: itemData.product_id,
                name: itemData.name,
                description: itemData.description,
                packagingType: itemData.packaging_type || 'box',
                weight: itemData.weight ?? null,
                dimensions: itemData.dimensions,
                unitaryPrice: itemData.unitary_price,
                metadata: itemData.metadata || {}
            }, { client: trx })

            transitItemsMap.set(itemData.id, ti)
        }

        return transitItemsMap
    }

}
