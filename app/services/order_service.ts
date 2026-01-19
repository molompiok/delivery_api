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
import logger from '@adonisjs/core/services/logger'
import { inject } from '@adonisjs/core'

@inject()
export default class OrderService {
    constructor(protected dispatchService: DispatchService) { }

    /**
     * Creates a new delivery order with multiple waypoints and legs.
     */
    async createOrder(clientId: string, payload: any) {
        const trx = await db.transaction()

        try {
            // 1. Process Waypoints (Geocode and Create Addresses)
            const processedWaypoints: any[] = []
            const allPackageInfos: any[] = []

            for (const waypoint of payload.waypoints) {
                // Ensure we have coordinates.
                let coordinates = waypoint.coordinates
                if (!coordinates) {
                    logger.debug({ address: waypoint.address_text }, 'Geocoding address...')
                    coordinates = await GeoService.geocode(waypoint.address_text)
                }

                if (!coordinates) {
                    throw new Error(`Geocoding failed for address: ${waypoint.address_text}. Please provide coordinates or a more precise address.`)
                }

                const address = await Address.create({
                    ownerType: 'Order',
                    ownerId: 'PENDING', // Will update after order creation
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

                if (waypoint.type === 'pickup' && waypoint.package_infos) {
                    allPackageInfos.push(...waypoint.package_infos)
                }
            }

            // 2. Prepare Order
            const newOrder = new Order()
            newOrder.clientId = clientId
            newOrder.status = 'PENDING'
            newOrder.refId = payload.ref_id // New Advanced Dispatch Field
            newOrder.assignmentMode = payload.assignment_mode || 'GLOBAL' // New Advanced Dispatch Field
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

            const routeDetails = await GeoService.calculateOptimizedRoute(routeWaypoints)
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
                currency: 'XOF'
            }

            await newOrder.useTransaction(trx).save()

            // 5. Create Legs
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
                }, { client: trx })
            }

            // 6. Create Packages
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
                }, { client: trx })
            }

            await trx.commit()

            // Reload order with relations
            await newOrder.load('legs')
            await newOrder.load('packages')

            // Emit Real-time Event
            // Emit Real-time Event
            emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                orderId: newOrder.id,
                status: newOrder.status,
                clientId: newOrder.clientId
            }))

            // Trigger Advanced Dispatch
            // We run this *after* the transaction commit to ensure data is visible and to avoid blocking the API response too long if dispatch is slow.
            // In a real production app, this might be offloaded to a queue.    
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
}
