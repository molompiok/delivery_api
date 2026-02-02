import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Action from '#models/action'
import ActionProof from '#models/action_proof'
import Stop from '#models/stop'
import Address from '#models/address'
import Order from '#models/order'
import Step from '#models/step'
import GeoService from '#services/geo_service'
import { LogisticsOperationResult } from '../../types/logistics.js'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { addStopSchema, updateStopSchema } from '../../validators/order_validator.js'
import vine from '@vinejs/vine'

export default class StopService {
    /**
     * Adds a stop to a step.
     */
    async addStop(stepId: string, clientId: string, data: any, trx?: TransactionClientContract): Promise<LogisticsOperationResult<Stop>> {
        const validatedData = await vine.validate({ schema: addStopSchema, data })
        const effectiveTrx = trx || await db.transaction()
        try {
            const step = await Step.query({ client: effectiveTrx }).where('id', stepId).first()
            if (!step) {
                throw new Error(`Step not found [ID: ${stepId}] while adding stop`)
            }
            const order = await Order.query({ client: effectiveTrx }).where('id', step.orderId).where('clientId', clientId).first()
            if (!order) throw new Error('Unauthorized or Order not found')
            // Geocode address if needed
            let coordinates: number[] | undefined | null = validatedData.coordinates as number[] | undefined
            if (!coordinates && validatedData.address_text) {
                const geocoded = await GeoService.geocode(validatedData.address_text)
                coordinates = geocoded as number[] | null
            }

            if (!coordinates && validatedData.address_text) {
                throw new Error(`Geocoding failed for ${validatedData.address_text}`)
            }

            // Create/Get Address
            const address = await Address.create({
                ownerType: 'Order',
                ownerId: order.id,
                label: 'Stop',
                lat: coordinates ? coordinates[1] : 0,
                lng: coordinates ? coordinates[0] : 0,
                formattedAddress: validatedData.address_text || '',
                street: validatedData.address_text || '',
                isActive: true,
                isDefault: false,
            }, { client: effectiveTrx })

            // Get last sequence
            const lastStop = await Stop.query()
                .useTransaction(effectiveTrx)
                .where('stepId', stepId)
                .orderBy('sequence', 'desc')
                .first()

            const sequence = validatedData.sequence ?? (lastStop ? lastStop.sequence + 1 : 0)

            const isDraft = order.status === 'DRAFT'

            const stop = await Stop.create({
                orderId: order.id,
                stepId: step.id,
                addressId: address.id,
                sequence,
                status: 'PENDING',
                isPendingChange: !isDraft,
            }, { client: effectiveTrx })

            if (!trx) await (effectiveTrx as any).commit()

            return {
                entity: stop,
                validationErrors: []
            }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }

    /**
     * Updates a stop.
     */
    async updateStop(stopId: string, clientId: string, data: any, trx?: TransactionClientContract): Promise<LogisticsOperationResult<Stop>> {
        const validatedData = await vine.validate({ schema: updateStopSchema, data })
        const effectiveTrx = trx || await db.transaction()
        try {
            const stop = await Stop.query({ client: effectiveTrx }).where('id', stopId).preload('address').first()
            if (!stop) throw new Error('Stop not found')

            const order = await Order.query({ client: effectiveTrx }).where('id', stop.orderId).where('clientId', clientId).first()
            if (!order) throw new Error('Unauthorized or Order not found')
            const isDraft = order.status === 'DRAFT'

            let targetStop = stop
            if (!isDraft && !stop.isPendingChange) {
                const existingShadow = await Stop.query({ client: effectiveTrx })
                    .where('originalId', stop.id)
                    .where('isPendingChange', true)
                    .first()

                if (existingShadow) {
                    targetStop = existingShadow
                } else {
                    // Clone address first
                    const originalAddress = await Address.query({ client: effectiveTrx }).where('id', stop.addressId).first()
                    if (!originalAddress) {
                        throw new Error(`Address not found [ID: ${stop.addressId}] while cloning stop [ID: ${stop.id}]`)
                    }
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

                    targetStop = await Stop.create({
                        orderId: stop.orderId,
                        stepId: stop.stepId,
                        addressId: newAddress.id,
                        sequence: stop.sequence,
                        status: stop.status,
                        metadata: stop.metadata,
                        originalId: stop.id,
                        isPendingChange: true
                    }, { client: effectiveTrx })

                    // Recursive cloning of actions for this stop
                    const originalActions = await Action.query({ client: effectiveTrx })
                        .where('stopId', stop.id)
                        .where('isPendingChange', false)

                    for (const act of originalActions) {
                        const newAction = await Action.create({
                            orderId: stop.orderId,
                            stopId: targetStop.id,
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

                        // Clone proofs too
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

            // Update Geocode if address changed
            if (validatedData.address_text || validatedData.coordinates) {
                let coords: number[] | undefined | null = validatedData.coordinates as number[] | undefined
                if (!coords && validatedData.address_text) {
                    const geocoded = await GeoService.geocode(validatedData.address_text)
                    coords = geocoded as number[] | null
                }

                if (coords) {
                    const address = await Address.query().useTransaction(effectiveTrx).where('id', targetStop.addressId).first()
                    if (address) {
                        address.lat = coords[1]
                        address.lng = coords[0]
                        address.formattedAddress = validatedData.address_text || address.formattedAddress
                        await address.useTransaction(effectiveTrx).save()
                    }
                }
            }

            if (validatedData.sequence !== undefined) targetStop.sequence = validatedData.sequence
            if (validatedData.metadata) targetStop.metadata = validatedData.metadata

            await targetStop.useTransaction(effectiveTrx).save()

            if (!trx) await (effectiveTrx as any).commit()

            return {
                entity: targetStop,
                validationErrors: []
            }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }

    /**
     * Removes a stop.
     */
    async removeStop(stopId: string, clientId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const stop = await Stop.query({ client: effectiveTrx }).where('id', stopId).first()
            if (!stop) throw new Error('Stop not found')

            const order = await Order.query({ client: effectiveTrx }).where('id', stop.orderId).where('clientId', clientId).first()
            if (!order) throw new Error('Unauthorized or Order not found')
            const isDraft = order.status === 'DRAFT'

            if (isDraft || stop.isPendingChange) {
                await stop.useTransaction(effectiveTrx).delete()
            } else {
                stop.isDeleteRequired = true
                await stop.useTransaction(effectiveTrx).save()
            }

            if (!trx) await (effectiveTrx as any).commit()
            return { success: true }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }
}
