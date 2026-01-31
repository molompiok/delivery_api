import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import Order from '#models/order'
import OrderLeg from '#models/order_leg'
import Address from '#models/address'
import GeoService from '#services/geo_service'
import PricingService, { SimplePackageInfo } from '#services/pricing_service'
import OrderStatusUpdated from '#events/order_status_updated'
import DispatchService from '#services/dispatch_service'
import VroomService from '#services/vroom_service'
import Step from '#models/step'
import Stop from '#models/stop'
import Action from '#models/action'
import TransitItem from '#models/transit_item'
import ActionProof from '#models/action_proof'
import LogisticsService from '#services/logistics_service'
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'
import { generateVerificationCode } from '#utils/verification_code'

@inject()
export default class OrderService {
    constructor(
        protected dispatchService: DispatchService,
        protected vroomService: VroomService
    ) { }

    /**
     * Calculates an estimation for a potential order without saving it.
     */
    async getEstimation(payload: any) {
        // 1. Process Waypoints (Geocode only)
        const processedWaypoints: any[] = []
        const pricingPackages: SimplePackageInfo[] = []

        for (const waypoint of payload.waypoints) {
            let coordinates = waypoint.coordinates
            if (!coordinates) {
                coordinates = await GeoService.geocode(waypoint.address_text)
            }

            if (!coordinates) {
                throw new Error(`Geocoding failed for ${waypoint.address_text}`)
            }

            processedWaypoints.push({
                ...waypoint,
                coordinates: coordinates,
            })

            if (waypoint.package_infos) {
                pricingPackages.push(...waypoint.package_infos.map((p: any) => ({
                    dimensions: p.dimensions || { weight_g: 1000 },
                    quantity: p.quantity || 1,
                    mention_warning: p.mention_warning
                })))
            }
        }

        // 2. Calculate Route
        const routeWaypoints = processedWaypoints.map(wp => ({
            coordinates: wp.coordinates as [number, number],
            type: 'break' as const,
        }))

        // Note: For estimation, we always use optimization to show the "Best Price"
        const routeDetails = await GeoService.calculateOptimizedRoute(routeWaypoints)
        if (!routeDetails) {
            throw new Error('Failed to calculate route')
        }

        // 3. Calculate Pricing
        const fees = await PricingService.calculateFees(
            routeDetails.global_summary.total_distance_meters,
            routeDetails.global_summary.total_duration_seconds,
            pricingPackages
        )

        // 4. Return summary
        const allCoords: number[][] = []
        routeDetails.legs.forEach(leg => {
            if (leg.geometry && leg.geometry.coordinates) {
                allCoords.push(...leg.geometry.coordinates)
            }
        })

        return {
            distanceMeters: routeDetails.global_summary.total_distance_meters,
            durationSeconds: routeDetails.global_summary.total_duration_seconds,
            pricing: fees,
            routeGeometry: { type: 'LineString', coordinates: allCoords },
            waypoints: processedWaypoints // Returns with coords
        }
    }

    /**
     * Creates a new universal delivery order based on the Step-Stop-Action architecture.
     */
    async createOrder(clientId: string, payload: any) {
        // 0. Integrity Validation
        const validation = LogisticsService.validateOrderConsistency(payload)
        if (!validation.success) {
            throw new Error(`Order integrity validation failed: ${validation.errors.join(', ')}`)
        }

        const trx = await db.transaction()

        try {
            const assignmentMode = payload.assignment_mode || 'GLOBAL'
            if (assignmentMode === 'TARGET' && !payload.ref_id) {
                throw new Error('TARGET assignment mode requires a ref_id')
            }

            // 1. Create Base Order
            const newOrder = new Order()
            newOrder.clientId = clientId
            newOrder.status = 'PENDING'
            newOrder.refId = payload.ref_id
            newOrder.assignmentMode = assignmentMode
            newOrder.priority = payload.priority || 'MEDIUM'
            newOrder.assignmentAttemptCount = 0
            newOrder.metadata = payload.metadata || {}

            await newOrder.useTransaction(trx).save()

            // 2. Create TransitItems (Catalogue for this order)
            const transitItemsMap = new Map<string, TransitItem>()
            if (payload.transit_items) {
                for (const itemData of payload.transit_items) {
                    const ti = await TransitItem.create({
                        orderId: newOrder.id,
                        productId: itemData.product_id,
                        name: itemData.name,
                        description: itemData.description,
                        packagingType: itemData.packaging_type || 'box',
                        weight: itemData.weight_g ? itemData.weight_g / 1000 : null,
                        dimensions: itemData.dimensions,
                        unitaryPrice: itemData.unitary_price,
                        metadata: itemData.metadata
                    }, { client: trx })
                    transitItemsMap.set(itemData.id, ti)
                }
            }

            // 3. Process Steps, Stops and Actions
            const allStopsForRouting: any[] = []
            let stepSequence = 0

            for (const stepData of payload.steps) {
                const step = await Step.create({
                    orderId: newOrder.id,
                    sequence: stepData.sequence ?? stepSequence++,
                    linked: stepData.linked ?? false,
                    status: 'PENDING',
                }, { client: trx })

                let stopSequence = 0
                for (const stopData of stepData.stops) {
                    // Geocode address if needed
                    let coordinates = stopData.coordinates
                    if (!coordinates) {
                        coordinates = await GeoService.geocode(stopData.address_text)
                    }
                    if (!coordinates) {
                        throw new Error(`Geocoding failed for ${stopData.address_text}`)
                    }

                    // Create/Get Address
                    const address = await Address.create({
                        ownerType: 'Order',
                        ownerId: newOrder.id,
                        label: 'Stop',
                        lat: coordinates[1],
                        lng: coordinates[0],
                        formattedAddress: stopData.address_text,
                        street: stopData.address_text,
                        isActive: true,
                        isDefault: false,
                    }, { client: trx })

                    const stop = await Stop.create({
                        orderId: newOrder.id,
                        stepId: step.id,
                        addressId: address.id,
                        sequence: stopData.sequence ?? stopSequence++,
                        status: 'PENDING',
                    }, { client: trx })

                    allStopsForRouting.push({
                        address_id: address.id,
                        address_text: stopData.address_text,
                        coordinates: coordinates,
                        type: 'break' as const, // For routing
                        stop_id: stop.id
                    })

                    // Create Actions
                    for (const actionData of stopData.actions) {
                        const transitItem = actionData.transit_item_id ? transitItemsMap.get(actionData.transit_item_id) : null

                        const actionDataSaved = await Action.create({
                            orderId: newOrder.id,
                            stopId: stop.id,
                            transitItemId: transitItem?.id || null,
                            type: actionData.type.toUpperCase() as any,
                            quantity: actionData.quantity || 1,
                            status: 'PENDING',
                            serviceTime: actionData.service_time || 300,
                            confirmationRules: actionData.confirmation_rules || {},
                            metadata: actionData.metadata || {}
                        }, { client: trx })

                        // Create ActionProofs
                        if (actionData.confirmation_rules) {
                            if (actionData.confirmation_rules.otp) {
                                await ActionProof.create({
                                    actionId: actionDataSaved.id,
                                    type: 'OTP',
                                    key: 'verify_otp',
                                    expectedValue: generateVerificationCode(),
                                    isVerified: false
                                }, { client: trx })
                            }
                            if (actionData.confirmation_rules.photo) {
                                await ActionProof.create({
                                    actionId: actionDataSaved.id,
                                    type: 'PHOTO',
                                    key: 'verify_photo',
                                    isVerified: false
                                }, { client: trx })
                            }
                            if (actionData.confirmation_rules.signature) {
                                await ActionProof.create({
                                    actionId: actionDataSaved.id,
                                    type: 'SIGNATURE',
                                    key: 'verify_signature',
                                    isVerified: false
                                }, { client: trx })
                            }
                        }
                    }
                }
            }

            // 4. Calculate Route and Legs
            const routeDetails = await GeoService.calculateOptimizedRoute(allStopsForRouting)
            if (!routeDetails) {
                throw new Error('Failed to calculate route')
            }

            // Update Order with route info
            newOrder.calculationEngine = routeDetails.calculation_engine
            newOrder.totalDistanceMeters = routeDetails.global_summary.total_distance_meters
            newOrder.totalDurationSeconds = routeDetails.global_summary.total_duration_seconds

            const allCoords: number[][] = []
            routeDetails.legs.forEach(leg => {
                if (leg.geometry && leg.geometry.coordinates) {
                    allCoords.push(...leg.geometry.coordinates)
                }
            })
            newOrder.routeGeometry = { type: 'LineString', coordinates: allCoords }

            newOrder.statusHistory = [{
                status: 'PENDING',
                timestamp: DateTime.now().toISO()!,
                note: 'Commande créée (Modèle Action-Stop)'
            }]

            newOrder.etaPickup = DateTime.now().plus({ seconds: routeDetails.global_summary.total_duration_seconds * 0.4 })
            newOrder.etaDelivery = DateTime.now().plus({ seconds: routeDetails.global_summary.total_duration_seconds })

            await newOrder.useTransaction(trx).save()

            // 5. Create Order Legs (Physical segments)
            for (let i = 0; i < routeDetails.legs.length; i++) {
                const legData = routeDetails.legs[i]
                const startWp = allStopsForRouting[i]
                const endWp = allStopsForRouting[i + 1]

                await OrderLeg.create({
                    orderId: newOrder.id,
                    sequence: i,
                    startAddressId: startWp.address_id,
                    endAddressId: endWp.address_id,
                    startCoordinates: { type: 'Point', coordinates: startWp.coordinates },
                    endCoordinates: { type: 'Point', coordinates: endWp.coordinates },
                    geometry: legData.geometry as any,
                    durationSeconds: legData.duration_seconds,
                    distanceMeters: legData.distance_meters,
                    maneuvers: legData.maneuvers,
                    rawData: legData.raw_valhalla_leg_data,
                    status: 'PLANNED',
                    statusHistory: []
                }, { client: trx })
            }

            // 6. Calculate Pricing
            const pricingPackages: SimplePackageInfo[] = []
            if (payload.transit_items) {
                pricingPackages.push(...payload.transit_items.map((it: any) => ({
                    dimensions: it.dimensions || { weight_g: 1000 },
                    quantity: 1, // Base item
                    mention_warning: 'none'
                })))
            }

            const fees = await PricingService.calculateFees(
                newOrder.totalDistanceMeters,
                newOrder.totalDurationSeconds,
                pricingPackages
            )

            newOrder.pricingData = {
                clientFee: fees.clientFee,
                driverRemuneration: fees.driverRemuneration,
                currency: fees.currency || 'XOF',
                breakdown: fees.breakdown
            }
            await newOrder.useTransaction(trx).save()

            await trx.commit()

            // Emit event and trigger dispatch
            emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                orderId: newOrder.id,
                status: newOrder.status,
                clientId: newOrder.clientId
            }))

            this.dispatchService.dispatch(newOrder).catch(err => {
                logger.error({ err, orderId: newOrder.id }, 'Async dispatch failed')
            })

            return newOrder
        } catch (error) {
            await trx.rollback()
            logger.error({ err: error }, 'Order creation failed')
            throw error
        }
    }

    /**
     * List orders for a client.
     */
    async listOrders(clientId: string) {
        return await Order.query()
            .where('clientId', clientId)
            .preload('steps', (stepsQuery) => {
                stepsQuery.preload('stops', (stopsQuery) => {
                    stopsQuery.preload('actions')
                })
            })
            .preload('transitItems')
            .orderBy('createdAt', 'desc')
    }

    /**
     * Get full order details for a client.
     */
    async getOrderDetails(orderId: string, clientId: string) {
        const order = await Order.query()
            .where('id', orderId)
            .andWhere('clientId', clientId)
            .preload('legs')
            .preload('steps', (stepsQuery) => {
                stepsQuery.preload('stops', (stopsQuery) => {
                    stopsQuery.preload('actions')
                    stopsQuery.preload('address')
                })
            })
            .preload('transitItems', (tiQuery) => {
                tiQuery.preload('product')
            })
            .preload('driver', (q) => q.preload('driverSetting'))
            .first()

        if (!order) {
            throw new Error('Order not found')
        }

        return order
    }

    /**
     * Updates an existing order.
     * Uses building a virtual state + validation before persistence.
     */
    async updateOrder(orderId: string, clientId: string, payload: any) {
        const order = await this.getOrderDetails(orderId, clientId)

        // 1. Build Virtual State (Current DB state + Payload overrides)
        const virtualState = this.buildVirtualState(order, payload)

        // 2. Validate Consistency
        const validation = LogisticsService.validateOrderConsistency(virtualState)
        if (!validation.success) {
            throw new Error(`Order update rejected: ${validation.errors.join(', ')}`)
        }

        // 3. Persist Changes (Atomic)
        const trx = await db.transaction()
        try {
            if (payload.metadata) order.metadata = payload.metadata
            if (payload.ref_id) order.refId = payload.ref_id

            await order.useTransaction(trx).save()
            await trx.commit()
            return order
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Builds a virtual representation of the order for validation.
     * Combines current DB state with proposed changes.
     */
    private buildVirtualState(order: Order, override?: { type: 'ACTION' | 'STOP' | 'STEP', id?: string, data?: any, remove?: boolean }): any {
        // Map DB state to payload-like structure
        const transitItems = order.transitItems.map(ti => ({
            id: ti.id,
            name: ti.name,
            weight_g: ti.weight ? ti.weight * 1000 : null,
            dimensions: ti.dimensions
        }))

        let steps = order.steps.map(step => ({
            id: step.id,
            sequence: step.sequence,
            linked: step.linked,
            stops: step.stops.map(stop => ({
                id: stop.id,
                address_text: stop.address?.formattedAddress || '',
                sequence: stop.sequence,
                actions: stop.actions.map(action => ({
                    id: action.id,
                    type: action.type,
                    quantity: action.quantity,
                    transit_item_id: action.transitItemId
                }))
            }))
        }))

        // Apply Overrides if any
        if (override) {
            if (override.type === 'ACTION') {
                steps.forEach(step => {
                    step.stops.forEach(stop => {
                        if (override.remove) {
                            stop.actions = stop.actions.filter(a => a.id !== override.id)
                        } else if (override.id) {
                            // Update existing
                            const action = stop.actions.find(a => a.id === override.id)
                            if (action) Object.assign(action, override.data)
                        } else if (stop.id === override.data.stop_id) {
                            // Add new
                            stop.actions.push(override.data)
                        }
                    })
                })
            } else if (override.type === 'STOP') {
                steps.forEach(step => {
                    if (override.remove) {
                        step.stops = step.stops.filter(s => s.id !== override.id)
                    } else if (override.id) {
                        const stop = step.stops.find(s => s.id === override.id)
                        if (stop) Object.assign(stop, override.data)
                    } else if (step.id === override.data.step_id) {
                        step.stops.push(override.data)
                    }
                })
            } else if (override.type === 'STEP') {
                if (override.remove) {
                    steps = steps.filter(s => s.id !== override.id)
                } else if (override.id) {
                    const step = steps.find(s => s.id === override.id)
                    if (step) Object.assign(step, override.data)
                } else {
                    steps.push(override.data)
                }
            }
        }

        return {
            transit_items: transitItems,
            steps: steps
        }
    }

    /**
     * Updates an action with informational/structural distinction.
     */
    async updateAction(actionId: string, clientId: string, data: any) {
        const action = await Action.query().where('id', actionId).preload('order').first()
        if (!action || action.order.clientId !== clientId) throw new Error('Action not found')

        const structuralFields = ['type', 'quantity', 'transit_item_id']
        const hasStructuralChange = structuralFields.some(f => f in data)

        if (hasStructuralChange) {
            const order = await this.getOrderDetails(action.orderId, clientId)
            const virtualState = this.buildVirtualState(order, {
                type: 'ACTION',
                id: actionId,
                data: {
                    type: (data.type || action.type).toUpperCase(),
                    quantity: data.quantity ?? action.quantity,
                    transit_item_id: data.transit_item_id ?? action.transitItemId
                }
            })

            const validation = LogisticsService.validateOrderConsistency(virtualState)
            if (!validation.success) {
                throw new Error(`Inconsistent action update: ${validation.errors.join(', ')}`)
            }
        }

        // Apply and Save
        const trx = await db.transaction()
        try {
            if (data.type) action.type = data.type.toUpperCase() as any
            if (data.quantity !== undefined) action.quantity = data.quantity
            if (data.transit_item_id !== undefined) action.transitItemId = data.transit_item_id
            if (data.service_time !== undefined) action.serviceTime = data.service_time
            if (data.confirmation_rules) action.confirmationRules = data.confirmation_rules
            if (data.metadata) action.metadata = data.metadata

            await action.useTransaction(trx).save()
            await trx.commit()
            return action
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Removes an action after integrity check.
     */
    async removeAction(actionId: string, clientId: string) {
        const action = await Action.query().where('id', actionId).preload('order').first()
        if (!action || action.order.clientId !== clientId) throw new Error('Action not found')

        const order = await this.getOrderDetails(action.orderId, clientId)
        const virtualState = this.buildVirtualState(order, { type: 'ACTION', id: actionId, remove: true })

        const validation = LogisticsService.validateOrderConsistency(virtualState)
        if (!validation.success) {
            throw new Error(`Cannot remove action: ${validation.errors.join(', ')}`)
        }

        await action.delete()
        return { success: true }
    }

    /**
     * Adds an action to a stop after integrity check.
     */
    async addAction(stopId: string, clientId: string, data: any) {
        const stop = await Stop.query().where('id', stopId).preload('order').first()
        if (!stop || stop.order.clientId !== clientId) throw new Error('Stop not found')

        const order = await this.getOrderDetails(stop.orderId, clientId)
        const virtualState = this.buildVirtualState(order, {
            type: 'ACTION',
            data: {
                stop_id: stopId,
                type: (data.type || 'SERVICE').toUpperCase(),
                quantity: data.quantity || 1,
                transit_item_id: data.transit_item_id
            }
        })

        const validation = LogisticsService.validateOrderConsistency(virtualState)
        if (!validation.success) {
            throw new Error(`Invalid action addition: ${validation.errors.join(', ')}`)
        }

        const trx = await db.transaction()
        try {
            const newAction = await Action.create({
                orderId: stop.orderId,
                stopId: stopId,
                type: (data.type || 'SERVICE').toUpperCase() as any,
                quantity: data.quantity || 1,
                transitItemId: data.transit_item_id || null,
                serviceTime: data.service_time || 300,
                status: 'PENDING',
                metadata: data.metadata || {}
            }, { client: trx })

            await trx.commit()
            return newAction
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Updates a stop.
     */
    async updateStop(stopId: string, clientId: string, data: any) {
        const stop = await Stop.query().where('id', stopId).preload('order').first()
        if (!stop || stop.order.clientId !== clientId) throw new Error('Stop not found')

        const structuralFields = ['sequence', 'coordinates', 'address_text']
        const hasStructuralChange = structuralFields.some(f => f in data)

        if (hasStructuralChange) {
            const order = await this.getOrderDetails(stop.orderId, clientId)
            const virtualState = this.buildVirtualState(order, {
                type: 'STOP',
                id: stopId,
                data: {
                    sequence: data.sequence ?? stop.sequence,
                    address_text: data.address_text || stop.addressId // Simplified
                }
            })

            const validation = LogisticsService.validateOrderConsistency(virtualState)
            if (!validation.success) throw new Error(`Inconsistent stop update: ${validation.errors.join(', ')}`)
        }

        const trx = await db.transaction()
        try {
            if (data.metadata) stop.metadata = data.metadata
            if (data.sequence !== undefined) stop.sequence = data.sequence

            // Address update requires more logic (lat/lng, etc.)
            // For now let's focus on metadata
            await stop.useTransaction(trx).save()
            await trx.commit()
            return stop
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Removes a stop.
     */
    async removeStop(stopId: string, clientId: string) {
        const stop = await Stop.query().where('id', stopId).preload('order').first()
        if (!stop || stop.order.clientId !== clientId) throw new Error('Stop not found')

        const order = await this.getOrderDetails(stop.orderId, clientId)
        const virtualState = this.buildVirtualState(order, { type: 'STOP', id: stopId, remove: true })

        const validation = LogisticsService.validateOrderConsistency(virtualState)
        if (!validation.success) throw new Error(`Cannot remove stop: ${validation.errors.join(', ')}`)

        await stop.delete()
        return { success: true }
    }

    /**
     * Updates a step.
     */
    async updateStep(stepId: string, clientId: string, data: any) {
        const step = await Step.query().where('id', stepId).preload('order').first()
        if (!step || step.order.clientId !== clientId) throw new Error('Step not found')

        const structuralFields = ['sequence', 'linked']
        const hasStructuralChange = structuralFields.some(f => f in data)

        if (hasStructuralChange) {
            const order = await this.getOrderDetails(step.orderId, clientId)
            const virtualState = this.buildVirtualState(order, {
                type: 'STEP',
                id: stepId,
                data: {
                    sequence: data.sequence ?? step.sequence,
                    linked: data.linked ?? step.linked
                }
            })

            const validation = LogisticsService.validateOrderConsistency(virtualState)
            if (!validation.success) throw new Error(`Inconsistent step update: ${validation.errors.join(', ')}`)
        }

        const trx = await db.transaction()
        try {
            if (data.metadata) step.metadata = data.metadata
            if (data.sequence !== undefined) step.sequence = data.sequence
            if (data.linked !== undefined) step.linked = data.linked

            await step.useTransaction(trx).save()
            await trx.commit()
            return step
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Removes a step.
     */
    async removeStep(stepId: string, clientId: string) {
        const step = await Step.query().where('id', stepId).preload('order').first()
        if (!step || step.order.clientId !== clientId) throw new Error('Step not found')

        const order = await this.getOrderDetails(step.orderId, clientId)
        const virtualState = this.buildVirtualState(order, { type: 'STEP', id: stepId, remove: true })

        const validation = LogisticsService.validateOrderConsistency(virtualState)
        if (!validation.success) throw new Error(`Cannot remove step: ${validation.errors.join(', ')}`)

        await step.delete()
        return { success: true }
    }

    /**
     * Cancel an order.
     */
    async cancelOrder(orderId: string, clientId: string, _reason: string) {
        const trx = await db.transaction()
        try {
            const order = await Order.query({ client: trx })
                .where('id', orderId)
                .andWhere('clientId', clientId)
                .forUpdate()
                .first()

            if (!order) {
                throw new Error('Order not found')
            }

            if (order.status !== 'PENDING') {
                throw new Error('Only pending orders can be cancelled')
            }

            order.status = 'CANCELLED'
            order.statusHistory = [
                ...(order.statusHistory || []),
                {
                    status: 'CANCELLED',
                    timestamp: DateTime.now().toISO()!,
                    note: `Cancelled by client. Reason: ${_reason}`
                }
            ]
            await order.useTransaction(trx).save()
            await trx.commit()

            // Notify via event
            emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                orderId: order.id,
                status: order.status,
                clientId: order.clientId
            }))

            return order
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }
}
