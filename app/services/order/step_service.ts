import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Step from '#models/step'
import Stop from '#models/stop'
import Action from '#models/action'
import ActionProof from '#models/action_proof'
import Address from '#models/address'
import Order from '#models/order'
import { LogisticsOperationResult } from '../../types/logistics.js'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { addStepSchema, updateStepSchema } from '../../validators/order_validator.js'
import vine from '@vinejs/vine'

export default class StepService {
    /**
     * Adds a step to an order.
     */
    async addStep(orderId: string, clientId: string, data: any = {}, trx?: TransactionClientContract): Promise<LogisticsOperationResult<Step>> {
        const validatedData = await vine.validate({ schema: addStepSchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            const order = await Order.query({ client: effectiveTrx }).where('id', orderId).where('clientId', clientId).first()
            if (!order) {
                throw new Error(`Order not found [ID: ${orderId}] for client [ID: ${clientId}] while adding step`)
            }

            // Get last sequence
            const lastStep = await Step.query()
                .useTransaction(effectiveTrx)
                .where('orderId', orderId)
                .orderBy('sequence', 'desc')
                .first()

            const sequence = validatedData.sequence ?? (lastStep ? lastStep.sequence + 1 : 0)

            const isDraft = order.status === 'DRAFT'

            const step = await Step.create({
                orderId,
                sequence,
                linked: validatedData.linked ?? false,
                status: 'PENDING',
                metadata: validatedData.metadata || {},
                isPendingChange: !isDraft,
            }, { client: effectiveTrx })

            if (!trx) await (effectiveTrx as any).commit()

            return {
                entity: step,
                validationErrors: []
            }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }

    /**
     * Updates a step.
     */
    async updateStep(stepId: string, clientId: string, data: any, trx?: TransactionClientContract): Promise<LogisticsOperationResult<Step>> {
        const validatedData = await vine.validate({ schema: updateStepSchema, data })
        const effectiveTrx = trx || await db.transaction()

        try {
            const step = await Step.query({ client: effectiveTrx }).where('id', stepId).first()
            if (!step) throw new Error('Step not found')

            const order = await Order.query({ client: effectiveTrx }).where('id', step.orderId).where('clientId', clientId).first()
            if (!order) {
                throw new Error(`Order not found [ID: ${step.orderId}] for client [ID: ${clientId}] while updating step [ID: ${stepId}]`)
            }
            const isDraft = order.status === 'DRAFT'

            let targetStep = step
            if (!isDraft && !step.isPendingChange) {
                const existingShadow = await Step.query({ client: effectiveTrx })
                    .where('originalId', step.id)
                    .where('isPendingChange', true)
                    .first()

                if (existingShadow) {
                    targetStep = existingShadow
                } else {
                    targetStep = await Step.create({
                        orderId: step.orderId,
                        sequence: step.sequence,
                        linked: step.linked,
                        status: step.status,
                        metadata: step.metadata,
                        originalId: step.id,
                        isPendingChange: true,
                    }, { client: effectiveTrx })

                    // Recursive cloning of stops (which will clone actions)
                    const originalStops = await Stop.query({ client: effectiveTrx })
                        .where('stepId', step.id)
                        .where('isPendingChange', false)

                    for (const st of originalStops) {
                        // Clone address first
                        const originalAddress = await Address.query({ client: effectiveTrx }).where('id', st.addressId).firstOrFail()
                        const newAddress = await Address.create({
                            ownerType: 'Order',
                            ownerId: originalAddress.ownerId,
                            label: originalAddress.label,
                            lat: originalAddress.lat,
                            lng: originalAddress.lng,
                            formattedAddress: originalAddress.formattedAddress,
                            street: originalAddress.street,
                            isActive: true,
                            isDefault: false,
                        }, { client: effectiveTrx })

                        const newStop = await Stop.create({
                            orderId: step.orderId,
                            stepId: targetStep.id,
                            addressId: newAddress.id,
                            sequence: st.sequence,
                            status: st.status,
                            metadata: st.metadata,
                            originalId: st.id,
                            isPendingChange: true
                        }, { client: effectiveTrx })

                        // Recursive actions
                        const originalActions = await Action.query({ client: effectiveTrx })
                            .where('stopId', st.id)
                            .where('isPendingChange', false)

                        for (const act of originalActions) {
                            const newAction = await Action.create({
                                orderId: step.orderId,
                                stopId: newStop.id,
                                transitItemId: act.transitItemId,
                                type: act.type,
                                quantity: act.quantity,
                                status: act.status,
                                serviceTime: act.serviceTime,
                                confirmationRules: act.confirmationRules,
                                metadata: act.metadata,
                                originalId: act.id,
                                isPendingChange: true,
                            }, { client: effectiveTrx })

                            const proofs = await ActionProof.query({ client: effectiveTrx }).where('actionId', act.id)
                            for (const proof of proofs) {
                                await ActionProof.create({
                                    actionId: newAction.id,
                                    type: proof.type,
                                    key: proof.key,
                                    expectedValue: proof.expectedValue,
                                    isVerified: proof.isVerified,
                                    metadata: proof.metadata
                                }, { client: effectiveTrx })
                            }
                        }
                    }
                }
            }

            if (validatedData.metadata) targetStep.metadata = validatedData.metadata
            if (validatedData.sequence !== undefined) targetStep.sequence = validatedData.sequence
            if (validatedData.linked !== undefined) targetStep.linked = validatedData.linked

            await targetStep.useTransaction(effectiveTrx).save()

            if (!trx) await (effectiveTrx as any).commit()

            return {
                entity: targetStep,
                validationErrors: []
            }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }

    /**
     * Removes a step.
     */
    async removeStep(stepId: string, clientId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()

        try {
            const step = await Step.query({ client: effectiveTrx }).where('id', stepId).first()
            if (!step) throw new Error('Step not found')

            const order = await Order.query({ client: effectiveTrx }).where('id', step.orderId).where('clientId', clientId).first()
            if (!order) {
                throw new Error(`Order not found [ID: ${step.orderId}] for client [ID: ${clientId}] while removing step [ID: ${stepId}]`)
            }
            const isDraft = order.status === 'DRAFT'

            if (isDraft || step.isPendingChange) {
                await step.useTransaction(effectiveTrx).delete()
            } else {
                step.isDeleteRequired = true
                await step.useTransaction(effectiveTrx).save()
            }
            if (!trx) await (effectiveTrx as any).commit()
            return { success: true }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }
}
