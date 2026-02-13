import db from '@adonisjs/lucid/services/db'
import Stop from '#models/stop'
import Address from '#models/address'
import Order from '#models/order'
import Step from '#models/step'
import GeoService from '#services/geo_service'
import { LogisticsOperationResult } from '../../types/logistics.js'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { addStopSchema, updateStopSchema } from '../../validators/order_validator.js'
import vine from '@vinejs/vine'
import { inject } from '@adonisjs/core'
import ActionService from './action_service.js'

@inject()
export default class StopService {
    constructor(protected actionService: ActionService) { }

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
            // Priority 1: Top-level coordinates [lat, lng]
            // Priority 2: Address lat/lng
            // Priority 3: Geocode from street
            let coordinates: number[] | undefined | null = undefined

            if (validatedData.coordinates && validatedData.coordinates.length === 2) {
                // Store as [lng, lat] internally for consistency with logic below
                coordinates = [validatedData.coordinates[1], validatedData.coordinates[0]]
            } else if (validatedData.address?.lat && validatedData.address?.lng) {
                coordinates = [validatedData.address.lng, validatedData.address.lat]
            }

            if (!coordinates && validatedData.address?.street) {
                const geocoded = await GeoService.geocode(validatedData.address.street)
                coordinates = geocoded as number[] | null
            }

            if (!coordinates && validatedData.address?.street) {
                throw new Error(`Geocoding failed for ${validatedData.address.street}`)
            }

            // Reverse Geocode if requested
            let addressInfo = {
                street: validatedData.address?.street || '',
                city: validatedData.address?.city || null,
                country: validatedData.address?.country || null
            }

            if (validatedData.reverse_geocode && coordinates) {
                const geoResult = await GeoService.reverseGeocode(coordinates[1], coordinates[0])
                if (geoResult) {
                    addressInfo = {
                        street: geoResult.street,
                        city: geoResult.city || addressInfo.city,
                        country: geoResult.country || addressInfo.country
                    }
                }
            }

            // Create/Get Address
            const address = await Address.create({
                ownerType: 'Order',
                ownerId: order.id,
                label: 'Stop',
                lat: coordinates ? coordinates[1] : 0,
                lng: coordinates ? coordinates[0] : 0,
                formattedAddress: addressInfo.street,
                street: addressInfo.street,
                city: addressInfo.city,
                country: addressInfo.country,
                call: validatedData.address?.call || null,
                room: validatedData.address?.room || null,
                stage: validatedData.address?.stage || null,
                isActive: true,
                isDefault: false,
            }, { client: effectiveTrx })

            // Get last display_order
            const lastStop = await Stop.query()
                .useTransaction(effectiveTrx)
                .where('stepId', stepId)
                .orderBy('display_order', 'desc')
                .first()

            const displayOrder = validatedData.display_order ?? (lastStop ? lastStop.displayOrder + 1 : 0)

            const isDraft = order.status === 'DRAFT'

            const targetStepId = step.isPendingChange && step.originalId ? step.originalId : step.id

            const stop = await Stop.create({
                orderId: order.id,
                stepId: targetStepId,
                addressId: address.id,
                displayOrder,
                executionOrder: null, // Set by VROOM later
                status: 'PENDING',
                isPendingChange: !isDraft,
                client: validatedData.client || null,
                metadata: validatedData.metadata || {}
            }, { client: effectiveTrx })

            // Action Creation
            if (validatedData.actions && validatedData.actions.length > 0) {
                for (const actionData of validatedData.actions) {
                    await this.actionService.addAction(stop.id, clientId, actionData, effectiveTrx)
                }
            }

            // Add default "point de passage" action if requested
            if (validatedData.add_default_service) {
                await this.actionService.addAction(stop.id, clientId, {
                    type: 'service',
                    service_time: 600, // 10 minutes
                    metadata: {
                        productName: 'Point de passage',
                        is_invisible_in_detail: true // Hint for UI
                    }
                }, effectiveTrx)
            }

            if (!isDraft) {
                order.hasPendingChanges = true
                await order.useTransaction(effectiveTrx).save()
            }

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
                        city: originalAddress.city,
                        country: originalAddress.country,
                        call: originalAddress.call,
                        room: originalAddress.room,
                        stage: originalAddress.stage,
                        isActive: true,
                        isDefault: false,
                    }, { client: effectiveTrx })

                    targetStop = await Stop.create({
                        orderId: stop.orderId,
                        stepId: stop.stepId,
                        addressId: newAddress.id,
                        displayOrder: stop.displayOrder,
                        executionOrder: stop.executionOrder,
                        status: stop.status,
                        client: stop.client,
                        metadata: stop.metadata,
                        originalId: stop.id,
                        isPendingChange: true
                    }, { client: effectiveTrx })

                    // Recursive cloning of actions REMOVED for Shallow Cloning
                    // Actions remain linked to the original stop ID
                }
            }

            // Update Address if provided
            if (validatedData.address) {
                let coords: number[] | undefined | null = validatedData.address.lat && validatedData.address.lng
                    ? [validatedData.address.lng, validatedData.address.lat]
                    : undefined

                if (!coords && validatedData.address.street) {
                    const geocoded = await GeoService.geocode(validatedData.address.street)
                    coords = geocoded as number[] | null
                }

                const address = await Address.query().useTransaction(effectiveTrx).where('id', targetStop.addressId).first()
                if (address) {
                    if (coords) {
                        address.lat = coords[1]
                        address.lng = coords[0]
                    }
                    if (validatedData.address.street !== undefined) {
                        address.formattedAddress = validatedData.address.street
                        address.street = validatedData.address.street
                    }
                    if (validatedData.address.city !== undefined) address.city = validatedData.address.city
                    if (validatedData.address.country !== undefined) address.country = validatedData.address.country
                    if (validatedData.address.call !== undefined) address.call = validatedData.address.call
                    if (validatedData.address.room !== undefined) address.room = validatedData.address.room
                    if (validatedData.address.stage !== undefined) address.stage = validatedData.address.stage
                    await address.useTransaction(effectiveTrx).save()
                }
            }

            if (validatedData.display_order !== undefined) targetStop.displayOrder = validatedData.display_order

            // Merge metadata for client and address_extra
            targetStop.metadata = {
                ...(targetStop.metadata || {}),
                ...(validatedData.metadata || {}),
            }

            if (validatedData.client !== undefined) {
                const baseClient = targetStop.client || {}
                const newClientData = validatedData.client || {}

                targetStop.client = {
                    ...baseClient,
                    ...newClientData,
                    opening_hours: newClientData.opening_hours
                        ? { ...(baseClient.opening_hours || {}), ...newClientData.opening_hours }
                        : baseClient.opening_hours
                }
            }

            await targetStop.useTransaction(effectiveTrx).save()

            await targetStop.useTransaction(effectiveTrx).save()

            // Recursive Action Sync REMOVED to align with Shallow Cloning philosophy
            // Child elements (Actions) remain linked to the original stop ID
            // or the originalId of the shadow stop if newly created.

            // If not draft, mark order as having pending changes
            if (!isDraft) {
                order.hasPendingChanges = true
                await order.useTransaction(effectiveTrx).save()
            }

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

            // If not draft, mark order as having pending changes
            if (!isDraft) {
                order.hasPendingChanges = true
                await order.useTransaction(effectiveTrx).save()
            }

            if (!trx) await (effectiveTrx as any).commit()

            return { success: true }
        } catch (error) {
            if (!trx) await (effectiveTrx as any).rollback()
            throw error
        }
    }
}
