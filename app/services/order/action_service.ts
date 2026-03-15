import db from '@adonisjs/lucid/services/db'
import Action from '#models/action'
import ActionProof from '#models/action_proof'
import Order from '#models/order'
import Stop from '#models/stop'
import { LogisticsOperationResult } from '../../types/logistics.js'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { addActionSchema, updateActionSchema } from '../../validators/order_validator.js'
import vine from '@vinejs/vine'
import { inject } from '@adonisjs/core'
import TransitItemService from './transit_item_service.js'
import TransitItem from '#models/transit_item'
import ValidationRuleEngine, { ItemValidationRules } from './validation_rule_engine.js'

@inject()
export default class ActionService {
    constructor(protected transitItemService: TransitItemService) { }

    private getAnchorIds(item: TransitItem | null): string[] {
        if (!item) return []
        const ids = new Set<string>()
        if (item.id) ids.add(item.id)
        if (item.originalId) ids.add(item.originalId)
        return Array.from(ids)
    }

    private async applyValidationForAction(action: Action, itemRules: ItemValidationRules | undefined, trx: TransactionClientContract) {
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
    }

    /**
     * Adds an action to a stop.
     */
    async addAction(stopId: string, clientId: string, data: any, trx?: TransactionClientContract, targetCompanyId?: string): Promise<LogisticsOperationResult<Action>> {
        const validatedData = await vine.validate({ schema: addActionSchema, data })
        const effectiveTrx = trx || await db.transaction()
        try {
            const stop = await Stop.query({ client: effectiveTrx }).where('id', stopId).first()
            if (!stop) throw new Error('Stop not found')

            const stopOrder = await Order.query({ client: effectiveTrx })
                .where('id', stop.orderId)
                .where((q) => {
                    q.where('clientId', clientId)
                    if (targetCompanyId) q.orWhere('companyId', targetCompanyId)
                })
                .first()
            if (!stopOrder) throw new Error('Stop not found or unauthorized')

            const isDraft = stopOrder.status === 'DRAFT'

            const isService = (validatedData.type || 'SERVICE').toLowerCase() === 'service'

            // Priority Logic for TransitItem + Strict Consistency Check
            let transitItemId: string | null = null
            let linkedTransitItemForRules: TransitItem | null = null
            if (!isService) {
                if (validatedData.transit_item) {
                    // Rule 2: Strict ID Consistency Check
                    if (validatedData.transit_item_id && validatedData.transit_item.id) {
                        if (validatedData.transit_item_id !== validatedData.transit_item.id) {
                            throw new Error('E_INCONSISTENT_TRANSIT_ITEM_ID: transit_item_id must match transit_item.id')
                        }
                    }

                    const tiId = validatedData.transit_item.id || validatedData.transit_item_id
                    if (tiId) {
                        // Attempt Update
                        const tiRes = await this.transitItemService.updateTransitItem(tiId, clientId, validatedData.transit_item, effectiveTrx, targetCompanyId)
                        linkedTransitItemForRules = tiRes.entity || null

                        if (tiRes.entity) {
                            transitItemId = tiId
                        } else {
                            // Fallback: Create if not found (Upsert resilience)
                            const createRes = await this.transitItemService.addTransitItem(stop.orderId, clientId, validatedData.transit_item, effectiveTrx, targetCompanyId)
                            transitItemId = createRes.entity!.id
                            linkedTransitItemForRules = createRes.entity || null
                        }
                    } else {
                        // Create new
                        const tiRes = await this.transitItemService.addTransitItem(stop.orderId, clientId, validatedData.transit_item, effectiveTrx, targetCompanyId)
                        transitItemId = tiRes.entity!.id
                        linkedTransitItemForRules = tiRes.entity || null
                    }
                } else if (validatedData.transit_item_id) {
                    // Rule 3: Verify existence
                    const exists = await this.transitItemService.findTransitItem(validatedData.transit_item_id, effectiveTrx)
                    if (!exists) {
                        throw new Error(`Transit item not found: ${validatedData.transit_item_id}`)
                    }
                    // Anchoring: Link to original if it's a shadow
                    transitItemId = (exists.isPendingChange && exists.originalId) ? exists.originalId : exists.id
                    linkedTransitItemForRules = exists
                }
            }

            const targetStopId = stop.isPendingChange && stop.originalId ? stop.originalId : stop.id

            const linkedItem = linkedTransitItemForRules || (transitItemId
                ? await this.transitItemService.findTransitItem(transitItemId, effectiveTrx)
                : null
            )

            const normalizedInputRules = ValidationRuleEngine.normalizeRuleSet(validatedData.confirmation_rules || {})
            const scopedRules = isService
                ? {
                    actionRules: normalizedInputRules,
                    itemRulesPatch: {} as ItemValidationRules,
                    hasItemScopedRules: false,
                }
                : ValidationRuleEngine.splitActionRulesByScope(normalizedInputRules)
            const actionLevelRules = scopedRules.actionRules
            let itemRules = linkedItem ? ValidationRuleEngine.extractItemValidationRules(linkedItem.metadata) : {}

            const newAction = await Action.create({
                orderId: stop.orderId,
                stopId: targetStopId,
                type: (validatedData.type || 'SERVICE').toUpperCase() as any,
                quantity: isService ? 0 : (validatedData.quantity || 1),
                transitItemId: transitItemId,
                serviceTime: validatedData.service_time || 300,
                status: 'PENDING',
                confirmationRules: actionLevelRules,
                metadata: validatedData.metadata || {},
                isPendingChange: !isDraft,
            }, { client: effectiveTrx })

            if (!isService && linkedItem && scopedRules.hasItemScopedRules) {
                itemRules = ValidationRuleEngine.mergeItemValidationRules(itemRules, scopedRules.itemRulesPatch)
                linkedItem.metadata = ValidationRuleEngine.setItemValidationRulesInMetadata(linkedItem.metadata, itemRules)
                await linkedItem.useTransaction(effectiveTrx).save()
            }

            await this.applyValidationForAction(newAction, itemRules, effectiveTrx)
            await newAction.useTransaction(effectiveTrx).save()

            if (!isService && linkedItem && scopedRules.hasItemScopedRules) {
                await this.transitItemService.syncItemValidationOnActions(
                    this.getAnchorIds(linkedItem),
                    itemRules,
                    effectiveTrx,
                    { skipActionIds: [newAction.id] }
                )
            }

            if (!isDraft) {
                stopOrder.hasPendingChanges = true
                await stopOrder.useTransaction(effectiveTrx).save()
            }

            if (!trx) await (effectiveTrx as any).commit()

            return {
                entity: newAction,
                validationErrors: [] // Validation handled at coordinator level if needed
            }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }

    /**
     * Updates an action.
     */
    async updateAction(actionId: string, clientId: string, data: any, trx?: TransactionClientContract, targetCompanyId?: string): Promise<LogisticsOperationResult<Action>> {
        const validatedData = await vine.validate({ schema: updateActionSchema, data })
        const effectiveTrx = trx || await db.transaction()
        try {
            const action = await Action.query({ client: effectiveTrx }).where('id', actionId).first()
            if (!action) throw new Error('Action not found')

            const actionOrder = await Order.query({ client: effectiveTrx })
                .where('id', action.orderId)
                .where((q) => {
                    q.where('clientId', clientId)
                    if (targetCompanyId) q.orWhere('companyId', targetCompanyId)
                })
                .first()
            if (!actionOrder) throw new Error('Action not found or unauthorized')

            const isDraft = actionOrder.status === 'DRAFT'

            let targetAction = action
            if (!isDraft && !action.isPendingChange) {
                // Check if a shadow already exists for this original
                const existingShadow = await Action.query({ client: effectiveTrx })
                    .where('originalId', action.id)
                    .where('isPendingChange', true)
                    .first()

                if (existingShadow) {
                    targetAction = existingShadow
                } else {
                    // Create shadow clone
                    targetAction = await Action.create({
                        orderId: action.orderId,
                        stopId: action.stopId,
                        transitItemId: action.transitItemId,
                        type: action.type,
                        quantity: action.quantity,
                        status: action.status,
                        serviceTime: action.serviceTime,
                        confirmationRules: action.confirmationRules,
                        metadata: action.metadata,
                        originalId: action.id,
                        isPendingChange: true
                    }, { client: effectiveTrx })
                }
            }

            if (validatedData.type) targetAction.type = validatedData.type.toUpperCase() as any
            const finalType = (targetAction.type as string).toLowerCase()
            const isService = finalType === 'service'

            if (validatedData.quantity !== undefined) {
                targetAction.quantity = isService ? 0 : validatedData.quantity
            } else if (isService) {
                targetAction.quantity = 0
            }

            if (validatedData.service_time !== undefined) targetAction.serviceTime = validatedData.service_time
            const scopedRules = validatedData.confirmation_rules !== undefined
                ? (
                    isService
                        ? {
                            actionRules: ValidationRuleEngine.normalizeRuleSet(validatedData.confirmation_rules || {}),
                            itemRulesPatch: {} as ItemValidationRules,
                            hasItemScopedRules: false,
                        }
                        : ValidationRuleEngine.splitActionRulesByScope(validatedData.confirmation_rules || {})
                )
                : null

            if (validatedData.confirmation_rules !== undefined) {
                targetAction.confirmationRules = scopedRules?.actionRules || ValidationRuleEngine.emptyRuleSet()
            }
            if (validatedData.metadata !== undefined) {
                targetAction.metadata = {
                    ...(targetAction.metadata || {}),
                    ...(validatedData.metadata || {})
                }
            }

            let linkedTransitItemForRules: TransitItem | null = null
            // Sync nested TransitItem if provided and not a service
            if (finalType !== 'service') {
                if (validatedData.transit_item) {
                    // Rule 2: Strict ID Consistency Check
                    if (validatedData.transit_item_id && validatedData.transit_item.id) {
                        if (validatedData.transit_item_id !== validatedData.transit_item.id) {
                            throw new Error('E_INCONSISTENT_TRANSIT_ITEM_ID: transit_item_id must match transit_item.id')
                        }
                    }

                    const tiId = validatedData.transit_item.id || validatedData.transit_item_id || targetAction.transitItemId
                    if (tiId) {
                        // Update existing (Rule 2: recursive update even if ID present)
                        const tiRes = await this.transitItemService.updateTransitItem(tiId, clientId, validatedData.transit_item, effectiveTrx)
                        targetAction.transitItemId = tiId
                        linkedTransitItemForRules = tiRes.entity || null
                    } else {
                        // Create new
                        const tiRes = await this.transitItemService.addTransitItem(actionOrder.id, clientId, validatedData.transit_item, effectiveTrx, targetCompanyId)
                        targetAction.transitItemId = tiRes.entity!.id
                        linkedTransitItemForRules = tiRes.entity || null
                    }
                } else if (validatedData.transit_item_id) {
                    const exists = await this.transitItemService.findTransitItem(validatedData.transit_item_id, effectiveTrx)
                    if (!exists) {
                        throw new Error(`E_TRANSIT_ITEM_NOT_FOUND: Item ${validatedData.transit_item_id} not found`)
                    }
                    // Anchoring: Link to original if it's a shadow
                    targetAction.transitItemId = (exists.isPendingChange && exists.originalId) ? exists.originalId : exists.id
                    linkedTransitItemForRules = exists
                }
            } else {
                targetAction.transitItemId = null
            }

            const linkedItem = !isService
                ? (linkedTransitItemForRules || (targetAction.transitItemId
                    ? await this.transitItemService.findTransitItem(targetAction.transitItemId, effectiveTrx)
                    : null))
                : null
            let itemRules = linkedItem ? ValidationRuleEngine.extractItemValidationRules(linkedItem.metadata) : {}

            if (!isService && linkedItem && scopedRules?.hasItemScopedRules) {
                itemRules = ValidationRuleEngine.mergeItemValidationRules(itemRules, scopedRules.itemRulesPatch)
                linkedItem.metadata = ValidationRuleEngine.setItemValidationRulesInMetadata(linkedItem.metadata, itemRules)
                await linkedItem.useTransaction(effectiveTrx).save()
            }

            await this.applyValidationForAction(targetAction, itemRules, effectiveTrx)
            await targetAction.useTransaction(effectiveTrx).save()

            if (!isService && linkedItem && scopedRules?.hasItemScopedRules) {
                await this.transitItemService.syncItemValidationOnActions(
                    this.getAnchorIds(linkedItem),
                    itemRules,
                    effectiveTrx,
                    { skipActionIds: [targetAction.id] }
                )
            }

            if (!isDraft) {
                actionOrder.hasPendingChanges = true
                await actionOrder.useTransaction(effectiveTrx).save()
            }

            if (!trx) await (effectiveTrx as any).commit()

            return {
                entity: targetAction,
                validationErrors: []
            }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }

    /**
     * Removes an action.
     */
    async removeAction(actionId: string, clientId: string, trx?: TransactionClientContract, targetCompanyId?: string) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const action = await Action.query({ client: effectiveTrx }).where('id', actionId).first()
            if (!action) throw new Error('Action not found')

            const actionOrder = await Order.query({ client: effectiveTrx })
                .where('id', action.orderId)
                .where((q) => {
                    q.where('clientId', clientId)
                    if (targetCompanyId) q.orWhere('companyId', targetCompanyId)
                })
                .first()
            if (!actionOrder) throw new Error('Action not found or unauthorized')

            const isDraft = actionOrder.status === 'DRAFT'
            const isShadow = action.isPendingChange && !!action.originalId

            if (isDraft) {
                // For drafts, purge proofs and action
                await ActionProof.query().useTransaction(effectiveTrx).where('actionId', action.id).delete()
                await action.useTransaction(effectiveTrx).delete()
            } else if (isShadow) {
                // If it's a shadow (edited version), we want to delete it AND mark the original for deletion
                const original = await Action.findOrFail(action.originalId!, { client: effectiveTrx })
                original.isDeleteRequired = true
                await original.useTransaction(effectiveTrx).save()

                await ActionProof.query().useTransaction(effectiveTrx).where('actionId', action.id).delete()
                await action.useTransaction(effectiveTrx).delete()
            } else if (action.isPendingChange) {
                // New pending action (no original), just delete it
                await ActionProof.query().useTransaction(effectiveTrx).where('actionId', action.id).delete()
                await action.useTransaction(effectiveTrx).delete()
            } else {
                // Stable action, mark for deletion
                action.isDeleteRequired = true
                await action.useTransaction(effectiveTrx).save()
            }

            if (!isDraft) {
                actionOrder.hasPendingChanges = true
                await actionOrder.useTransaction(effectiveTrx).save()
            }

            if (!trx) await (effectiveTrx as any).commit()

            return { success: true }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }

    /**
     * Internal helper to process action confirmation rules.
     */
    async processActionRules(actionId: string, rules: any, trx: TransactionClientContract) {
        await ValidationRuleEngine.applyProofsForAction({
            actionId,
            rules,
            trx,
            source: 'ACTION',
            phase: 'service',
        })
    }
}
