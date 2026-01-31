import { BaseCommand } from '@adonisjs/core/ace'
import app from '@adonisjs/core/services/app'

export default class ValidateOrderWorkflow extends BaseCommand {
    static commandName = 'validate:order-workflow'
    static description = 'Validates the new Step-Stop-Action order creation'

    async run() {
        this.logger.info('Starting Order Workflow Validation...')

        if (!app.isBooted) {
            this.logger.info('Booting app...')
            await app.boot()
        }

        // Dynamic imports
        const { default: User } = await import('#models/user')
        const { default: MissionService } = await import('#services/mission_service')
        const { default: OrderService } = await import('#services/order_service')
        const { default: DispatchService } = await import('#services/dispatch_service')
        const VroomService: any = class { }

        const client = await User.query().where('isAdmin', true).first()
        const driver = await User.query().where('isDriver', true).first()

        if (!client || !driver) {
            this.logger.error('No admin or driver user found')
            return
        }

        const missionService = new MissionService(new DispatchService())
        const orderService = new OrderService(new DispatchService(), new VroomService())

        // --- Scenario 1: Simple Delivery (A+ -> B-) ---
        this.logger.info('--- Scenario 1: Simple Delivery (A+ -> B-) ---')
        const scenario1 = {
            steps: [{
                stops: [
                    {
                        address_text: 'Plateau, Abidjan (A)',
                        actions: [{ type: 'pickup', transit_item_id: 'box_01', quantity: 1, confirmation_rules: { otp: true, photo: true } }]
                    },
                    {
                        address_text: 'Cocody, Abidjan (B)',
                        actions: [{ type: 'delivery', transit_item_id: 'box_01', quantity: 1, confirmation_rules: { otp: true } }]
                    }
                ]
            }],
            transit_items: [{ id: 'box_01', name: 'Colis test 01' }]
        }

        try {
            const order1 = await orderService.createOrder(client.id, scenario1)
            await this.executeOrderWorkflow(order1, driver.id, missionService)
            this.logger.success('Scenario 1 fully validated.')

            // --- Scenario 2: Complex Scenario (Multiple Pickup/Delivery Mixed) ---
            this.logger.info('--- Scenario 2: Complex Scenario (Multiple Mixed) ---')
            const scenario2 = {
                transit_items: [
                    { id: 'colis1', name: 'Colis 1' },
                    { id: 'colis2', name: 'Colis 2' },
                    { id: 'colis3', name: 'Colis 3' },
                    { id: 'colis4', name: 'Colis 4' }
                ],
                steps: [
                    {
                        sequence: 1, stops: [{
                            address_text: 'Plateau', coordinates: [-4.019, 5.330], actions: [
                                { type: 'pickup', transit_item_id: 'colis1', quantity: 12 },
                                { type: 'pickup', transit_item_id: 'colis2', quantity: 5 },
                                { type: 'pickup', transit_item_id: 'colis3', quantity: 1 }
                            ]
                        }]
                    },
                    {
                        sequence: 2, stops: [{
                            address_text: 'Adjamé', coordinates: [-4.012, 5.352], actions: [
                                { type: 'delivery', transit_item_id: 'colis1', quantity: 4 },
                                { type: 'pickup', transit_item_id: 'colis3', quantity: 1 },
                                { type: 'pickup', transit_item_id: 'colis4', quantity: 1 }
                            ]
                        }]
                    },
                    {
                        sequence: 3, stops: [{
                            address_text: 'Cocody', coordinates: [-3.978, 5.344], actions: [
                                { type: 'delivery', transit_item_id: 'colis1', quantity: 6 },
                                { type: 'delivery', transit_item_id: 'colis3', quantity: 2 }
                            ]
                        }]
                    },
                    {
                        sequence: 4, stops: [{
                            address_text: 'Marcory', coordinates: [-3.987, 5.302], actions: [
                                { type: 'delivery', transit_item_id: 'colis1', quantity: 2 },
                                { type: 'delivery', transit_item_id: 'colis2', quantity: 5 }
                            ]
                        }]
                    },
                    {
                        sequence: 5, stops: [{
                            address_text: 'Treichville', coordinates: [-4.001, 5.312], actions: [
                                { type: 'delivery', transit_item_id: 'colis4', quantity: 1 }
                            ]
                        }]
                    }
                ]
            }

            const order2 = await orderService.createOrder(client.id, scenario2)
            await this.executeOrderWorkflow(order2, driver.id, missionService)
            this.logger.success('Scenario 2 fully validated.')

            // --- Scenario 3: Integrity Rejection ---
            this.logger.info('--- Scenario 3: Testing Integrity Rejection ---')
            const invalidScenario = {
                transit_items: [{ id: 'fail', name: 'Failure' }],
                steps: [{
                    stops: [
                        { address_text: 'P1', coordinates: [-4.0, 5.3], actions: [{ type: 'pickup', transit_item_id: 'fail', quantity: 1 }] },
                        { address_text: 'D1', coordinates: [-4.1, 5.4], actions: [{ type: 'delivery', transit_item_id: 'fail', quantity: 2 }] }
                    ]
                }]
            }
            try {
                await orderService.createOrder(client.id, invalidScenario)
                this.logger.error('Should have failed!')
            } catch (err) {
                this.logger.success(`Correctly rejected: ${err.message}`)
            }

        } catch (error) {
            this.logger.error(`Validation failed: ${error.message}`)
            console.error(error)
        }

        this.logger.info('Validation complete.')
    }

    /**
     * Helper to execute a full order workflow
     */
    private async executeOrderWorkflow(order: any, driverId: string, missionService: any) {
        // 1. Accept
        await missionService.acceptMission(driverId, order.id)
        await order.refresh()
        this.logger.info(`Mission accepted. Status: ${order.status}`)

        // 2. Load Steps, Stops and Actions in hierarchal order
        await order.load('steps', (sq: any) => {
            sq.orderBy('sequence', 'asc')
            sq.preload('stops', (stq: any) => {
                stq.orderBy('sequence', 'asc')
                stq.preload('actions', (aq: any) => aq.preload('proofs'))
            })
        })

        let stopIndex = 1
        for (const step of order.steps) {
            for (const stop of step.stops) {
                this.logger.info(`Arriving at stop ${stopIndex++}: ${stop.id} (Step Seq: ${step.sequence}, Stop Seq: ${stop.sequence})`)
                await missionService.arrivedAtStop(driverId, stop.id)

                for (const action of stop.actions) {
                    const proofs: any = {}
                    if (action.proofs && action.proofs.length > 0) {
                        for (const proof of action.proofs) {
                            if (proof.type === 'OTP') proofs.verify_otp = proof.expectedValue
                            if (proof.type === 'PHOTO') proofs.verify_photo = 'mock_photo_id'
                        }
                    }

                    this.logger.info(`  Executing ${action.type} for ${action.transitItemId} (Qty: ${action.quantity})`)
                    await missionService.completeAction(driverId, action.id, proofs)
                }
            }
        }

        await order.refresh()
        if (order.status !== 'DELIVERED') {
            throw new Error(`Order should be DELIVERED but is ${order.status}`)
        }
        this.logger.success(`Order ${order.id} finished with status: ${order.status}`)
    }
}
