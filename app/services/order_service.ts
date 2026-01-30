import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import Order from '#models/order'
import OrderLeg from '#models/order_leg'
import Package from '#models/package'
import Address from '#models/address'
import GeoService from '#services/geo_service'
import PricingService, { SimplePackageInfo } from '#services/pricing_service'
import OrderStatusUpdated from '#events/order_status_updated'
import DispatchService from '#services/dispatch_service'
import VroomService from '#services/vroom_service'
import Task from '#models/task'
import Shipment from '#models/shipment'
import Job from '#models/job'
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'

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
     * Creates a new delivery order with multiple waypoints and legs.
     */
    async createOrder(clientId: string, payload: any) {
        const trx = await db.transaction()

        try {
            const assignmentMode = payload.assignment_mode || 'GLOBAL'
            if (assignmentMode === 'TARGET' && !payload.ref_id) {
                throw new Error('TARGET assignment mode requires a ref_id')
            }

            // 1. Process Waypoints (Geocode and Create Addresses)
            const processedWaypoints: any[] = []
            const allPackageInfos: any[] = []

            for (const waypoint of payload.waypoints) {
                let coordinates = waypoint.coordinates
                if (!coordinates) {
                    coordinates = await GeoService.geocode(waypoint.address_text)
                }

                if (!coordinates) {
                    throw new Error(`Geocoding failed for: ${waypoint.address_text}`)
                }

                const address = await Address.create({
                    ownerType: 'Order',
                    ownerId: 'PENDING',
                    label: waypoint.type === 'pickup' ? 'Pickup' : 'Delivery',
                    lat: coordinates[1],
                    lng: coordinates[0],
                    formattedAddress: waypoint.address_text,
                    street: waypoint.address_text,
                    isActive: true,
                    isDefault: false,
                }, { client: trx })

                processedWaypoints.push({
                    ...waypoint,
                    addressId: address.id,
                    coordinates: coordinates,
                })

                if (waypoint.package_infos) {
                    allPackageInfos.push(...waypoint.package_infos.map((p: any) => ({
                        ...p,
                        pickupWaypointSequence: waypoint.waypoint_sequence || 0
                    })))
                }
            }

            // 2. Prepare Order
            const newOrder = new Order()
            newOrder.clientId = clientId
            newOrder.status = 'PENDING'
            newOrder.refId = payload.ref_id
            newOrder.assignmentMode = assignmentMode
            newOrder.priority = payload.priority || 'MEDIUM'
            newOrder.assignmentAttemptCount = 0
            newOrder.pickupAddressId = processedWaypoints.find(w => w.type === 'pickup').addressId
            newOrder.deliveryAddressId = [...processedWaypoints].reverse().find(w => w.type === 'delivery').addressId

            await newOrder.useTransaction(trx).save()

            // Update addresses ownerId
            for (const wp of processedWaypoints) {
                const addr = await Address.find(wp.addressId, { client: trx })
                if (addr) {
                    addr.ownerId = newOrder.id
                    await addr.useTransaction(trx).save()
                }
            }

            // 3. Calculate Route and Legs
            const routeWaypoints = processedWaypoints.map(wp => ({
                coordinates: wp.coordinates as [number, number],
                type: 'break' as const,
                address_id: wp.addressId,
                address_text: wp.address_text,
                waypoint_type_for_summary: wp.type,
                package_name_for_summary: wp.package_infos?.[0]?.name,
            }))

            // Use optimization unless explicitly disabled
            const routeDetails = payload.optimize_route === false
                ? await GeoService.calculateOptimizedRoute(routeWaypoints) // TODO: Implement non-optimized in GeoService if needed
                : await GeoService.calculateOptimizedRoute(routeWaypoints)

            if (!routeDetails) {
                throw new Error('Failed to calculate route')
            }

            newOrder.calculationEngine = routeDetails.calculation_engine
            newOrder.waypointsSummary = routeDetails.waypoints_summary_for_order || null
            newOrder.totalDistanceMeters = routeDetails.global_summary.total_distance_meters
            newOrder.totalDurationSeconds = routeDetails.global_summary.total_duration_seconds

            // 4. Calculate Pricing
            const pricingPackages: SimplePackageInfo[] = allPackageInfos.map(p => ({
                dimensions: p.dimensions || { weight_g: 1000 },
                quantity: p.quantity || 1,
                mention_warning: p.mention_warning
            }))

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
                note: 'Commande créée'
            }]

            newOrder.etaPickup = DateTime.now().plus({ seconds: routeDetails.global_summary.total_duration_seconds * 0.4 })
            newOrder.etaDelivery = DateTime.now().plus({ seconds: routeDetails.global_summary.total_duration_seconds })

            await newOrder.useTransaction(trx).save()

            // 5. Create Legs
            const { generateVerificationCode } = await import('#utils/verification_code')
            for (let i = 0; i < routeDetails.legs.length; i++) {
                const legData = routeDetails.legs[i]
                const startWp = routeWaypoints[i]
                const endWp = routeWaypoints[i + 1]

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
                    verificationCode: generateVerificationCode(),
                    isVerified: false,
                }, { client: trx })
            }

            // 6. Create Packages with waypoint linking
            for (const pkgInfo of allPackageInfos) {
                await Package.create({
                    orderId: newOrder.id,
                    name: pkgInfo.name,
                    description: pkgInfo.description,
                    dimensionsJson: pkgInfo.dimensions,
                    quantity: pkgInfo.quantity || 1,
                    weight: pkgInfo.dimensions?.weight_g || 0,
                    mentionWarning: pkgInfo.mention_warning,
                    fragility: pkgInfo.mention_warning === 'fragile' ? 'MEDIUM' : 'NONE',
                    isCold: false,
                    deliveryWaypointSequence: pkgInfo.delivery_waypoint_sequence || null
                }, { client: trx })
            }

            await trx.commit()

            await newOrder.load('legs')
            await newOrder.load('packages')

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

    async createComplexOrder(clientId: string, payload: any) {
        const trx = await db.transaction()

        try {
            // 1. Create Base Order
            const newOrder = new Order()
            newOrder.clientId = clientId
            newOrder.status = 'PENDING'
            newOrder.refId = payload.ref_id
            newOrder.assignmentMode = payload.assignment_mode || 'GLOBAL'
            newOrder.isComplex = true
            newOrder.logicPattern = payload.logic_pattern || 'G3'
            newOrder.priority = payload.priority || 'MEDIUM'

            await newOrder.useTransaction(trx).save()

            let firstPickupAddressId: string | null = null

            // 2. Process Shipments
            if (payload.shipments) {
                for (const shpData of payload.shipments) {
                    // Create Pickup Address & Task
                    const pAddr = await Address.create({
                        ownerType: 'Order',
                        ownerId: newOrder.id,
                        label: 'Pickup',
                        lat: shpData.pickup.coordinates[1],
                        lng: shpData.pickup.coordinates[0],
                        formattedAddress: shpData.pickup.address_text,
                        street: shpData.pickup.address_text,
                        isActive: true,
                    }, { client: trx })

                    if (!firstPickupAddressId) firstPickupAddressId = pAddr.id

                    const pTask = await Task.create({
                        orderId: newOrder.id,
                        addressId: pAddr.id,
                        type: 'PICKUP',
                        status: 'PENDING',
                        serviceTime: shpData.pickup.service_time || 300,
                    }, { client: trx })

                    // Create Delivery Address & Task
                    const dAddr = await Address.create({
                        ownerType: 'Order',
                        ownerId: newOrder.id,
                        label: 'Delivery',
                        lat: shpData.delivery.coordinates[1],
                        lng: shpData.delivery.coordinates[0],
                        formattedAddress: shpData.delivery.address_text,
                        street: shpData.delivery.address_text,
                        isActive: true,
                    }, { client: trx })

                    const dTask = await Task.create({
                        orderId: newOrder.id,
                        addressId: dAddr.id,
                        type: 'DELIVERY',
                        status: 'PENDING',
                        serviceTime: shpData.delivery.service_time || 300,
                    }, { client: trx })

                    // Create Shipment link
                    await Shipment.create({
                        orderId: newOrder.id,
                        pickupTaskId: pTask.id,
                        deliveryTaskId: dTask.id,
                        status: 'PENDING'
                    }, { client: trx })

                    // Link packages to shipment (Optional, for now we just create packages)
                    if (shpData.package) {
                        await Package.create({
                            orderId: newOrder.id,
                            name: shpData.package.name,
                            weight: shpData.package.weight || 0,
                            dimensionsJson: shpData.package.dimensions,
                            fragility: 'NONE',
                            isCold: false,
                        }, { client: trx })
                    }
                }
            }

            // 3. Process Jobs
            if (payload.jobs) {
                for (const jobData of payload.jobs) {
                    const jAddr = await Address.create({
                        ownerType: 'Order',
                        ownerId: newOrder.id,
                        label: 'Service',
                        lat: jobData.coordinates[1],
                        lng: jobData.coordinates[0],
                        formattedAddress: jobData.address_text,
                        street: jobData.address_text,
                        isActive: true,
                    }, { client: trx })

                    const jTask = await Task.create({
                        orderId: newOrder.id,
                        addressId: jAddr.id,
                        type: 'SERVICE',
                        status: 'PENDING',
                        serviceTime: jobData.service_time || 600,
                    }, { client: trx })

                    await Job.create({
                        orderId: newOrder.id,
                        taskId: jTask.id,
                        status: 'PENDING'
                    }, { client: trx })
                }
            }

            await trx.commit()

            // Trigger dispatch
            this.dispatchService.dispatch(newOrder).catch(err => {
                logger.error({ err, orderId: newOrder.id }, 'Async dispatch failed for complex order')
            })

            return newOrder
        } catch (error) {
            await trx.rollback()
            logger.error({ err: error }, 'Complex order creation failed')
            throw error
        }
    }
}
