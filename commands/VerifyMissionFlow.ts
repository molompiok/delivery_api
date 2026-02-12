import { BaseCommand } from '@adonisjs/core/ace'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order_service'
import MissionService from '#services/mission_service'
import Order from '#models/order'
import Stop from '#models/stop'
import Action from '#models/action'
import User from '#models/user'
import Company from '#models/company'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

export default class VerifyMissionFlow extends BaseCommand {
    static commandName = 'verify:mission-flow'
    static description = 'Verify the Action-Centric Mission Workflow'

    @inject()
    async run(orderService: OrderService, missionService: MissionService) {
        await this.app.boot()
        this.logger.info('Starting Mission Workflow Verification...')

        const trx = await db.transaction()

        try {
            // 1. Setup: Create a Driver and a Client
            const valhallaCompany = await Company.findBy('name', 'Valhalla Transports', { client: trx }) || await Company.firstOrFail({ client: trx })

            // Create Driver
            const finalDriver = await User.query({ client: trx }).where('email', 'driver@test.com').first()
                || await User.create({ email: 'driver@test.com', fullName: 'Test Driver', isDriver: true, isActive: true, fcmToken: 'valid_device_token', password: 'password', phone: '+2250700000000' }, { client: trx })

            // Ensure DriverSetting exists
            const DriverSetting = (await import('#models/driver_setting')).default
            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default

            // Helper to get or create driver setting
            let driverSetting = await DriverSetting.findBy('userId', finalDriver.id, { client: trx })
            if (!driverSetting) {
                driverSetting = await DriverSetting.create({
                    userId: finalDriver.id,
                    vehicleType: 'MOTORCYCLE',
                    vehiclePlate: 'TEST-123',
                }, { client: trx })
            }

            // Link Driver to Company (ACCEPTED status)
            const cds = await CompanyDriverSetting.query({ client: trx })
                .where('companyId', valhallaCompany.id)
                .where('driverId', finalDriver.id)
                .first()

            if (!cds) {
                await CompanyDriverSetting.create({
                    companyId: valhallaCompany.id,
                    driverId: finalDriver.id,
                    status: 'ACCEPTED',
                    docsStatus: 'APPROVED',
                    invitedAt: DateTime.now(),
                    acceptedAt: DateTime.now()
                }, { client: trx })

                // Update current company in driver setting
                // driverSetting.currentCompanyId = valhallaCompany.id // Schema mismatch: column missing in DB
                // await driverSetting.useTransaction(trx).save()
            }

            // Create Client
            const finalClient = await User.query({ client: trx }).where('email', 'client@test.com').first()
                || await User.create({ email: 'client@test.com', fullName: 'Test Client', isActive: true, password: 'password' }, { client: trx })


            this.logger.info(`Using Driver: ${finalDriver.email} and Client: ${finalClient.email}`)
            await this.waitHere(200)

            // 2. Create Order
            const payload = {
                transit_items: [
                    {
                        id: "ref_pkg_a", // Reference ID
                        name: "Package A",
                        quantity: 1,
                        weight: 5
                    },
                    {
                        id: "ref_pkg_b",
                        name: "Package B",
                        quantity: 1,
                        weight: 2
                    }
                ],
                steps: [
                    {
                        sequence: 1,
                        stops: [
                            {
                                display_order: 1,
                                address: { formatted_address: "Pickup A", lat: 5.35, lng: -4.0, street: "Rue 123", city: "Abidjan" },
                                actions: [
                                    { type: 'pickup', transit_item_id: 'ref_pkg_a' },
                                    { type: 'pickup', transit_item_id: 'ref_pkg_b' }
                                ]
                            },
                            {
                                display_order: 2,
                                address: { formatted_address: "Delivery A", lat: 5.36, lng: -4.01, street: "Rue 456", city: "Abidjan" },
                                actions: [
                                    { type: 'delivery', transit_item_id: 'ref_pkg_a' }
                                ]
                            },
                            {
                                display_order: 3,
                                address: { formatted_address: "Delivery B", lat: 5.37, lng: -4.02, street: "Rue 789", city: "Abidjan" },
                                actions: [
                                    { type: 'delivery', transit_item_id: 'ref_pkg_b' }
                                ]
                            }
                        ]
                    }
                ],
                vehicle_type: 'moto',
                scheduled_slot: { date: '2024-12-25', start: '10:00', end: '12:00' }
            }

            this.logger.info('Creating Order...')
            // Pass trx to createOrder
            const orderData = await orderService.createOrder(finalClient.id, payload, trx)
            let order = await Order.findOrFail(orderData.id, { client: trx })

            // Simulate Dispatch Offer
            order.offeredDriverId = finalDriver.id
            order.status = 'PENDING'
            await order.useTransaction(trx).save()

            this.logger.info(`Order Created: ${order.id}. Status: ${order.status}`)
            await this.waitHere(200)

            // 3. Accept Mission
            this.logger.info('Accepting Mission...')
            await missionService.acceptMission(finalDriver.id, order.id, trx)
            await order.refresh() // This refresh might not use the transaction. Let's refetch.
            order = await Order.findOrFail(order.id, { client: trx }) // Re-fetch order within transaction

            if (order.status !== 'ACCEPTED') throw new Error(`Expected ACCEPTED, got ${order.status}`)
            if (order.driverId !== finalDriver.id) throw new Error('Driver not assigned')
            this.logger.success('Mission Accepted')
            await this.waitHere(200)

            // 4. Arrive at First Stop (Pickup)
            await order.load('stops', q => q.orderBy('display_order', 'asc').preload('actions'))
            const pickupStop = order.stops[0] // Should be Pickup A

            this.logger.info(`Arriving at Stop 1: ${pickupStop.id}`)
            await missionService.arrivedAtStop(finalDriver.id, pickupStop.id, trx)
            // Reload stop with latest status from DB
            const refreshedStop = await Stop.findOrFail(pickupStop.id, { client: trx })

            if (refreshedStop.status !== 'ARRIVED') throw new Error(`Expected ARRIVED, got ${refreshedStop.status}`)

            // Using loaded instance might be stale, refresh it
            // Actually refresh() uses default connection if not bound?
            // Order instance was bound via findOrFail using trx? No, findOrFail loaded it.
            // .refresh() uses the model's $trx if set?
            // We should ensure we fetch fresh using trx.
            const refreshedOrder = await Order.findOrFail(order.id, { client: trx })

            if (refreshedOrder.status !== 'ACCEPTED') throw new Error(`Expected ACCEPTED, got ${refreshedOrder.status}`)
            this.logger.success('Arrived at Pickup. Order remains ACCEPTED.')
            await this.waitHere(200)

            // 5. Complete Actions Partially (1 Done, 1 Frozen)
            await refreshedStop.load('actions')
            const actions = refreshedStop.actions
            this.logger.info(`Found ${actions.length} actions at pickup`)

            // Action 1: Complete
            this.logger.info('Completing Action 1...')
            const action1 = actions[0]
            await missionService.completeAction(finalDriver.id, action1.id, {}, [], trx)

            const refreshedAction1 = await Action.findOrFail(action1.id, { client: trx })
            if (refreshedAction1.status !== 'COMPLETED') throw new Error('Action 1 not completed')
            await this.waitHere(200)

            // Action 2: Freeze
            this.logger.info('Freezing Action 2...')
            const action2 = actions[1]

            await missionService.freezeAction(finalDriver.id, action2.id, 'Customer absent', trx)
            const refreshedAction2 = await Action.findOrFail(action2.id, { client: trx }) // Ensure we fetch using TRX

            if (refreshedAction2.status !== 'FROZEN') throw new Error('Action 2 not frozen')

            const finalStopState = await Stop.findOrFail(refreshedStop.id, { client: trx })
            // According to logic: All terminal (1 completed, 1 frozen) -> PARTIAL because one is frozen/failed.
            if (finalStopState.status !== 'PARTIAL') throw new Error(`Expected PARTIAL, got ${finalStopState.status}`)
            this.logger.success('Stop is PARTIAL (1 Done, 1 Frozen)')

            const finalOrderState = await Order.findOrFail(order.id, { client: trx })
            // 1 Pickup Done, 1 Frozen -> All Pickups Terminal -> COLLECTED?
            // Logic: if allPickupsTerminal && anyPickupCompleted -> COLLECTED.
            if (finalOrderState.status !== 'ACCEPTED') throw new Error(`Expected ACCEPTED, got ${finalOrderState.status}`)
            this.logger.success('Pickup Finished. Order remains ACCEPTED.')

            this.logger.success('Verification Complete! Rolling back transaction...')
            await trx.rollback()
        } catch (error) {
            this.logger.error(error)
            await trx.rollback()
            process.exit(1)
        }
    }

    private async waitHere(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}
