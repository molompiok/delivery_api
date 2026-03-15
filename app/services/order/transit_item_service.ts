import db from '@adonisjs/lucid/services/db'
import TransitItem from '#models/transit_item'
import Order from '#models/order'
import { LogisticsOperationResult } from '../../types/logistics.js'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { transitItemSchema } from '../../validators/order_validator.js'
import vine from '@vinejs/vine'
import { inject } from '@adonisjs/core'
import wsService from '#services/ws_service'
import Action from '#models/action'
import ValidationRuleEngine, { ItemValidationRules } from './validation_rule_engine.js'

@inject()
export default class TransitItemService {
  private getAnchorIds(item: TransitItem): string[] {
    const ids = new Set<string>()
    if (item.id) ids.add(item.id)
    if (item.originalId) ids.add(item.originalId)
    return Array.from(ids)
  }

  async syncItemValidationOnActions(
    itemIds: string[],
    itemRules: ItemValidationRules,
    trx: TransactionClientContract,
    options?: { skipActionIds?: string[] }
  ): Promise<void> {
    if (!itemIds.length) return

    const skipIds = new Set(options?.skipActionIds || [])
    const actions = await Action.query({ client: trx })
      .whereIn('transitItemId', itemIds)
      .whereNotIn('status', ['COMPLETED', 'CANCELLED', 'FAILED'])

    for (const action of actions) {
      if (skipIds.has(action.id)) continue

      const resolved = ValidationRuleEngine.resolveEffectiveRulesForAction({
        actionType: action.type,
        actionRules: action.confirmationRules,
        itemRules,
      })

      await ValidationRuleEngine.applyProofsForAction({
        actionId: action.id,
        rules: resolved.rules,
        trx,
        source: resolved.source,
        phase: resolved.phase,
      })

      action.metadata = {
        ...(action.metadata || {}),
        validationSource: resolved.source,
      }
      await action.useTransaction(trx).save()
    }
  }

  /**
   * Adds a transit item to an order.
   */
  async findTransitItem(
    itemId: string,
    trx?: TransactionClientContract
  ): Promise<TransitItem | null> {
    return TransitItem.query({ client: trx }).where('id', itemId).first()
  }

  /**
   * Adds a transit item to an order.
   */
  async addTransitItem(
    orderId: string,
    clientId: string,
    data: any,
    trx?: TransactionClientContract,
    targetCompanyId?: string
  ): Promise<LogisticsOperationResult<TransitItem>> {
    const validatedData = await vine.validate({ schema: transitItemSchema, data })
    const effectiveTrx = trx || (await db.transaction())
    try {
      const order = await Order.query({ client: effectiveTrx })
        .where('id', orderId)
        .where((q) => {
          q.where('clientId', clientId)
          if (targetCompanyId) q.orWhere('companyId', targetCompanyId)
        })
        .firstOrFail()
      const isDraft = order.status === 'DRAFT'

      const itemRules = ValidationRuleEngine.normalizeItemValidationRules(
        validatedData.validation_rules
      )
      let metadata = validatedData.metadata || {}
      if (validatedData.validation_rules !== undefined) {
        metadata = ValidationRuleEngine.setItemValidationRulesInMetadata(metadata, itemRules)
      }

      const ti = await TransitItem.create(
        {
          orderId: order.id,
          productId: validatedData.product_id,
          name: validatedData.name,
          description: validatedData.description,
          packagingType: validatedData.packaging_type || 'box',
          weight: validatedData.weight ?? null,
          dimensions: validatedData.dimensions,
          unitaryPrice: validatedData.unitary_price,
          clientName: validatedData.client_name,
          clientPhone: validatedData.client_phone,
          clientReference: validatedData.client_reference,
          metadata,
          isPendingChange: !isDraft,
        },
        { client: effectiveTrx }
      )

      if (!isDraft) {
        order.hasPendingChanges = true
        await order.useTransaction(effectiveTrx).save()
      }

      const effectiveRules = ValidationRuleEngine.extractItemValidationRules(ti.metadata)
      await this.syncItemValidationOnActions(this.getAnchorIds(ti), effectiveRules, effectiveTrx)

      if (!trx) await (effectiveTrx as any).commit()

      wsService.notifyOrderUpdate(order.id, order.clientId)

      return {
        entity: ti,
        validationErrors: [],
      }
    } catch (error) {
      if (!trx) await (effectiveTrx as any).rollback()
      throw error
    }
  }

  /**
   * Updates a transit item.
   */
  async updateTransitItem(
    itemId: string,
    clientId: string,
    data: any,
    trx?: TransactionClientContract,
    targetCompanyId?: string
  ): Promise<LogisticsOperationResult<TransitItem>> {
    const validatedData = await vine.validate({ schema: transitItemSchema, data })
    const effectiveTrx = trx || (await db.transaction())
    try {
      const ti = await TransitItem.query({ client: effectiveTrx }).where('id', itemId).first()
      if (!ti) return { entity: null as any, validationErrors: [] }

      const order = await Order.query({ client: effectiveTrx })
        .where('id', ti.orderId)
        .where((q) => {
          q.where('clientId', clientId)
          if (targetCompanyId) q.orWhere('companyId', targetCompanyId)
        })
        .firstOrFail()
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
          targetTi = await TransitItem.create(
            {
              orderId: ti.orderId,
              productId: ti.productId,
              name: ti.name,
              description: ti.description,
              packagingType: ti.packagingType,
              weight: ti.weight,
              dimensions: ti.dimensions,
              unitaryPrice: ti.unitaryPrice,
              clientName: ti.clientName,
              clientPhone: ti.clientPhone,
              clientReference: ti.clientReference,
              metadata: ti.metadata,
              originalId: ti.id,
              isPendingChange: true,
            },
            { client: effectiveTrx }
          )
        }
      }

      if (validatedData.product_id !== undefined) targetTi.productId = validatedData.product_id
      if (validatedData.name !== undefined) targetTi.name = validatedData.name
      if (validatedData.description !== undefined) targetTi.description = validatedData.description
      if (validatedData.packaging_type !== undefined)
        targetTi.packagingType = validatedData.packaging_type
      if (validatedData.weight !== undefined) targetTi.weight = validatedData.weight
      if (validatedData.unitary_price !== undefined)
        targetTi.unitaryPrice = validatedData.unitary_price
      if (validatedData.client_name !== undefined) targetTi.clientName = validatedData.client_name
      if (validatedData.client_phone !== undefined)
        targetTi.clientPhone = validatedData.client_phone
      if (validatedData.client_reference !== undefined)
        targetTi.clientReference = validatedData.client_reference

      if (validatedData.dimensions !== undefined) {
        targetTi.dimensions = {
          ...(targetTi.dimensions || {}),
          ...(validatedData.dimensions || {}),
        }
      }

      if (validatedData.metadata !== undefined) {
        targetTi.metadata = {
          ...(targetTi.metadata || {}),
          ...(validatedData.metadata || {}),
        }
      }

      if (validatedData.validation_rules !== undefined) {
        const normalizedRules = ValidationRuleEngine.normalizeItemValidationRules(
          validatedData.validation_rules
        )
        targetTi.metadata = ValidationRuleEngine.setItemValidationRulesInMetadata(
          targetTi.metadata,
          normalizedRules
        )
      }

      await targetTi.useTransaction(effectiveTrx).save()

      const effectiveRules = ValidationRuleEngine.extractItemValidationRules(targetTi.metadata)
      await this.syncItemValidationOnActions(
        this.getAnchorIds(targetTi),
        effectiveRules,
        effectiveTrx
      )

      if (!isDraft) {
        order.hasPendingChanges = true
        await order.useTransaction(effectiveTrx).save()
      }

      if (!trx) await (effectiveTrx as any).commit()

      wsService.notifyOrderUpdate(order.id, order.clientId)

      return {
        entity: targetTi,
        validationErrors: [],
      }
    } catch (error) {
      if (!trx) await (effectiveTrx as any).rollback()
      throw error
    }
  }

  /**
   * Bulk creates transit items and returns a mapping from input ID to real UUID.
   */
  async createBulk(
    orderId: string,
    transitItems: any[],
    trx: TransactionClientContract
  ): Promise<Map<string, TransitItem>> {
    const transitItemsMap = new Map<string, TransitItem>()

    for (const itemData of transitItems) {
      let ti: TransitItem | null = null

      if (itemData.id) {
        // Try to find existing
        ti = await TransitItem.query({ client: trx }).where('id', itemData.id).first()
      }

      if (ti) {
        // Determine client ID from order if possible, or assume it's passed if we had it.
        // For simplicity in createBulk, we do a direct update.
        ti.productId = itemData.product_id
        ti.name = itemData.name
        ti.description = itemData.description
        ti.packagingType = itemData.packaging_type || 'box'
        ti.weight = itemData.weight ?? null
        ti.dimensions = itemData.dimensions
        ti.unitaryPrice = itemData.unitary_price
        ti.clientName = itemData.client_name
        ti.clientPhone = itemData.client_phone
        ti.clientReference = itemData.client_reference
        let nextMetadata = itemData.metadata || {}
        if (itemData.validation_rules !== undefined) {
          const normalizedRules = ValidationRuleEngine.normalizeItemValidationRules(
            itemData.validation_rules
          )
          nextMetadata = ValidationRuleEngine.setItemValidationRulesInMetadata(
            nextMetadata,
            normalizedRules
          )
        }
        ti.metadata = nextMetadata
        await ti.useTransaction(trx).save()
      } else {
        let nextMetadata = itemData.metadata || {}
        if (itemData.validation_rules !== undefined) {
          const normalizedRules = ValidationRuleEngine.normalizeItemValidationRules(
            itemData.validation_rules
          )
          nextMetadata = ValidationRuleEngine.setItemValidationRulesInMetadata(
            nextMetadata,
            normalizedRules
          )
        }
        ti = await TransitItem.create(
          {
            id: itemData.id, // Use pre-generated ID if available
            orderId: orderId,
            productId: itemData.product_id,
            name: itemData.name,
            description: itemData.description,
            packagingType: itemData.packaging_type || 'box',
            weight: itemData.weight ?? null,
            dimensions: itemData.dimensions,
            unitaryPrice: itemData.unitary_price,
            clientName: itemData.client_name,
            clientPhone: itemData.client_phone,
            clientReference: itemData.client_reference,
            metadata: nextMetadata,
          },
          { client: trx }
        )
      }

      transitItemsMap.set(itemData.id || ti.id, ti)
    }

    return transitItemsMap
  }
}
