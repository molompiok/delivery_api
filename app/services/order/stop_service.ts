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

    private hasFiniteNumber(value: unknown): value is number {
        return typeof value === 'number' && Number.isFinite(value)
    }

    private async resolveAddressCoordinates(data: {
        coordinates?: number[]
        address?: { lat?: number, lng?: number, street?: string, address_id?: string }
    }): Promise<[number, number]> {
        if (data.address?.address_id) {
            throw new Error('E_ADDRESS_ID_NOT_ALLOWED: address_id is not supported in stop payload. Send street/lat/lng instead.')
        }

        // Priority 1: Top-level coordinates [lat, lng]
        if (Array.isArray(data.coordinates) && data.coordinates.length === 2) {
            const [lat, lng] = data.coordinates
            if (this.hasFiniteNumber(lat) && this.hasFiniteNumber(lng)) {
                return [lng, lat]
            }
        }

        // Priority 2: Address lat/lng
        if (this.hasFiniteNumber(data.address?.lat) && this.hasFiniteNumber(data.address?.lng)) {
            return [data.address!.lng!, data.address!.lat!]
        }

        // Priority 3: Geocode from street
        if (data.address?.street) {
            const geocoded = await GeoService.geocode(data.address.street)
            if (geocoded && this.hasFiniteNumber(geocoded[0]) && this.hasFiniteNumber(geocoded[1])) {
                return geocoded as [number, number]
            }
            throw new Error(`E_GEOCODING_FAILED: unable to geocode address "${data.address.street}"`)
        }

        throw new Error('E_MISSING_COORDINATES: provide coordinates [lat,lng], address.lat/address.lng, or a geocodable address.street')
    }

    /**
     * Adds a stop to a step.
     */
    async addStop(stepId: string, clientId: string, data: any, trx?: TransactionClientContract, targetCompanyId?: string): Promise<LogisticsOperationResult<Stop>> {
        const validatedData = await vine.validate({ schema: addStopSchema, data })
        const effectiveTrx = trx || await db.transaction()
        try {
            const step = await Step.query({ client: effectiveTrx }).where('id', stepId).first()
            if (!step) {
                throw new Error(`Step not found [ID: ${stepId}] while adding stop`)
            }
            const order = await Order.query({ client: effectiveTrx })
                .where('id', step.orderId)
                .where((q) => {
                    q.where('clientId', clientId)
                    if (targetCompanyId) q.orWhere('companyId', targetCompanyId)
                })
                .first()
            if (!order) throw new Error('Unauthorized or Order not found')
            const coordinates = await this.resolveAddressCoordinates(validatedData as any)

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
                metadata: validatedData.metadata || {},
                reversalAmount: validatedData.reversal_amount ?? 0,
                includeWithdrawalFees: validatedData.include_withdrawal_fees ?? true,
                deliveryFee: validatedData.delivery_fee ?? null,
            }, { client: effectiveTrx })

            // Action Creation
            if (validatedData.actions && validatedData.actions.length > 0) {
                for (const actionData of validatedData.actions) {
                    await this.actionService.addAction(stop.id, clientId, actionData, effectiveTrx, targetCompanyId)
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
                }, effectiveTrx, targetCompanyId)
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
    async updateStop(stopId: string, clientId: string, data: any, trx?: TransactionClientContract, targetCompanyId?: string): Promise<LogisticsOperationResult<Stop>> {
        const validatedData = await vine.validate({ schema: updateStopSchema, data })
        const effectiveTrx = trx || await db.transaction()
        try {
            const stop = await Stop.query({ client: effectiveTrx }).where('id', stopId).preload('address').first()
            if (!stop) throw new Error('Stop not found')

            const order = await Order.query({ client: effectiveTrx })
                .where('id', stop.orderId)
                .where((q) => {
                    q.where('clientId', clientId)
                    if (targetCompanyId) q.orWhere('companyId', targetCompanyId)
                })
                .first()
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
                        reversalAmount: stop.reversalAmount,
                        includeWithdrawalFees: stop.includeWithdrawalFees,
                        deliveryFee: stop.deliveryFee,
                        originalId: stop.id,
                        isPendingChange: true
                    }, { client: effectiveTrx })

                    // Recursive cloning of actions REMOVED for Shallow Cloning
                    // Actions remain linked to the original stop ID
                }
            }

            // Update Address if provided
            if (validatedData.address) {
                const coords = await this.resolveAddressCoordinates({
                    address: validatedData.address as any
                })

                const address = await Address.query().useTransaction(effectiveTrx).where('id', targetStop.addressId).first()
                if (address) {
                    address.lat = coords[1]
                    address.lng = coords[0]
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
            if (validatedData.reversal_amount !== undefined) targetStop.reversalAmount = validatedData.reversal_amount
            if (validatedData.include_withdrawal_fees !== undefined) targetStop.includeWithdrawalFees = validatedData.include_withdrawal_fees
            if (validatedData.delivery_fee !== undefined) targetStop.deliveryFee = validatedData.delivery_fee

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
    async removeStop(stopId: string, clientId: string, trx?: TransactionClientContract, targetCompanyId?: string) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const stop = await Stop.query({ client: effectiveTrx }).where('id', stopId).first()
            if (!stop) throw new Error('Stop not found')

            const order = await Order.query({ client: effectiveTrx })
                .where('id', stop.orderId)
                .where((q) => {
                    q.where('clientId', clientId)
                    if (targetCompanyId) q.orWhere('companyId', targetCompanyId)
                })
                .first()
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

    /**
     * Restores the original price for a stop by removing overrides.
     */
    async restorePrice(stopId: string, clientId: string, trx?: TransactionClientContract, targetCompanyId?: string) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const stop = await Stop.query({ client: effectiveTrx }).where('id', stopId).first()
            if (!stop) throw new Error('Stop not found')

            const order = await Order.query({ client: effectiveTrx })
                .where('id', stop.orderId)
                .where((q) => {
                    q.where('clientId', clientId)
                    if (targetCompanyId) q.orWhere('companyId', targetCompanyId)
                })
                .first()
            if (!order) throw new Error('Unauthorized or Order not found')

            const meta = stop.metadata || {}
            if (meta.price_override) {
                delete meta.price_override
                stop.metadata = { ...meta }
                await stop.useTransaction(effectiveTrx).save()
            }

            if (order.status !== 'DRAFT') {
                order.hasPendingChanges = true
                await order.useTransaction(effectiveTrx).save()
            }

            if (!trx) await effectiveTrx.commit()

            return { success: true, entity: stop }
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }
}
