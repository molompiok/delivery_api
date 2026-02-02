import db from '@adonisjs/lucid/services/db'
import Action from '#models/action'
import ActionProof from '#models/action_proof'
import Order from '#models/order'
import Stop from '#models/stop'
import { generateVerificationCode } from '#utils/verification_code'
import { LogisticsOperationResult } from '../../types/logistics.js'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { addActionSchema, updateActionSchema } from '../../validators/order_validator.js'
import vine from '@vinejs/vine'

export default class ActionService {
    /**
     * Adds an action to a stop.
     */
    async addAction(stopId: string, clientId: string, data: any, trx?: TransactionClientContract): Promise<LogisticsOperationResult<Action>> {
        const validatedData = await vine.validate({ schema: addActionSchema, data })
        const effectiveTrx = trx || await db.transaction()
        try {
            const stop = await Stop.query({ client: effectiveTrx }).where('id', stopId).first()
            if (!stop) throw new Error('Stop not found')

            const stopOrder = await Order.query({ client: effectiveTrx }).where('id', stop.orderId).where('clientId', clientId).first()
            if (!stopOrder) throw new Error('Stop not found or unauthorized')

            const isDraft = stopOrder.status === 'DRAFT'

            const isService = (validatedData.type || 'SERVICE').toLowerCase() === 'service'

            const newAction = await Action.create({
                orderId: stop.orderId,
                stopId: stopId,
                type: (validatedData.type || 'SERVICE').toUpperCase() as any,
                quantity: isService ? 0 : (validatedData.quantity || 1),
                transitItemId: isService ? null : (validatedData.transit_item_id || null),
                serviceTime: validatedData.service_time || 300,
                status: 'PENDING',
                confirmationRules: validatedData.confirmation_rules || {},
                metadata: validatedData.metadata || {},
                isPendingChange: !isDraft,
            }, { client: effectiveTrx })

            if (validatedData.confirmation_rules) {
                await this.processActionRules(newAction.id, validatedData.confirmation_rules, effectiveTrx)
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
    async updateAction(actionId: string, clientId: string, data: any, trx?: TransactionClientContract): Promise<LogisticsOperationResult<Action>> {
        const validatedData = await vine.validate({ schema: updateActionSchema, data })
        const effectiveTrx = trx || await db.transaction()
        try {
            const action = await Action.query({ client: effectiveTrx }).where('id', actionId).first()
            if (!action) throw new Error('Action not found')

            const actionOrder = await Order.query({ client: effectiveTrx }).where('id', action.orderId).where('clientId', clientId).first()
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

            if (isService) {
                targetAction.transitItemId = null
            } else if (validatedData.transit_item_id !== undefined) {
                targetAction.transitItemId = validatedData.transit_item_id
            }

            if (validatedData.service_time !== undefined) targetAction.serviceTime = validatedData.service_time
            if (validatedData.confirmation_rules) targetAction.confirmationRules = validatedData.confirmation_rules
            if (validatedData.metadata) targetAction.metadata = validatedData.metadata

            await targetAction.useTransaction(effectiveTrx).save()

            if (validatedData.confirmation_rules) {
                await this.processActionRules(targetAction.id, validatedData.confirmation_rules, effectiveTrx)
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
    async removeAction(actionId: string, clientId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const action = await Action.query({ client: effectiveTrx }).where('id', actionId).first()
            if (!action) throw new Error('Action not found')

            const actionOrder = await Order.query({ client: effectiveTrx }).where('id', action.orderId).where('clientId', clientId).first()
            if (!actionOrder) throw new Error('Action not found or unauthorized')

            const isDraft = actionOrder.status === 'DRAFT'

            if (isDraft || action.isPendingChange) {
                // If it's a draft or a shadow itself, we just delete it
                await ActionProof.query().useTransaction(effectiveTrx).where('actionId', action.id).delete()
                await action.useTransaction(effectiveTrx).delete()
            } else {
                // If it's a stable component, we mark it for deletion
                action.isDeleteRequired = true
                await action.useTransaction(effectiveTrx).save()
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
        // Clear existing proofs if any (for updates)
        await ActionProof.query().useTransaction(trx).where('actionId', actionId).delete()

        // Process PHOTO rules
        if (rules.photo && Array.isArray(rules.photo)) {
            for (const photoRule of rules.photo) {
                await ActionProof.create({
                    actionId,
                    type: 'PHOTO',
                    key: photoRule.name || 'verify_photo',
                    expectedValue: photoRule.reference || null,
                    isVerified: false,
                    metadata: {
                        pickup: photoRule.pickup ?? false,
                        delivery: photoRule.delivery ?? false,
                        compare: photoRule.compare ?? false,
                    }
                }, { client: trx })
            }
        }

        // Process CODE rules
        if (rules.code && Array.isArray(rules.code)) {
            for (const codeRule of rules.code) {
                await ActionProof.create({
                    actionId,
                    type: 'CODE',
                    key: codeRule.name || 'verify_code',
                    expectedValue: codeRule.reference || codeRule.compare ? generateVerificationCode() : null,
                    isVerified: false,
                    metadata: {
                        pickup: codeRule.pickup ?? false,
                        delivery: codeRule.delivery ?? false,
                        compare: codeRule.compare ?? false,
                    }
                }, { client: trx })
            }
        }
    }
}
