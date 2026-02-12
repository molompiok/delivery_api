import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import OrderService from '#services/order_service'
import ActionService from '#services/order/action_service'
import StopService from '#services/order/stop_service'
import StepService from '#services/order/step_service'
import TransitItemService from '#services/order/transit_item_service'
import OrderDraftService from '#services/order/order_draft_service'
import User from '#models/user'

/**
 * Utility to simulate network delay or interval between calls
 */
const waitHere = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default class ValidateOrderWorkflow extends BaseCommand {
    static commandName = 'validate:order-workflow'
    static description = 'Validate the order creation workflow (Atomic vs Bulk)'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('🚀 Starting Order Workflow Validation...')

        // Manual resolution to avoid early injection issues in Ace
        const orderService = await this.app.container.make(OrderService)
        const actionService = await this.app.container.make(ActionService)
        const stopService = await this.app.container.make(StopService)
        const stepService = await this.app.container.make(StepService)
        const transitItemService = await this.app.container.make(TransitItemService)
        const orderDraftService = await this.app.container.make(OrderDraftService)

        // 1. Get a test client
        const client = await User.query().first()
        if (!client) {
            this.logger.error('❌ No user found in database. Please run seeders.')
            return
        }

        this.logger.info(`👤 Using Client: ${client.fullName} (${client.id})`)

        try {
            const services = {
                orderDraftService,
                transitItemService,
                stepService,
                stopService,
                actionService
            }

            await this.runAtomicFlow(client.id, services)
            await waitHere(500)
            await this.runBulkFlow(client.id, orderService)
            await waitHere(500)
            await this.runComplexScenario(client.id, services)
            await waitHere(500)
            await this.runModificationScenario(client.id, services, orderService)

            this.logger.success('\n✅ All validation scenarios completed successfully!')
        } catch (error) {
            this.logger.error(`\n❌ Validation failed: ${error.message}`)
            this.logger.error(error.stack)
        }
    }

    /**
     * Test 1: Atomic creation (Step by Step)
     */
    private async runAtomicFlow(clientId: string, services: any) {
        this.logger.info('\n--- [SCENARIO 1: ATOMIC FLOW] ---')
        const { orderDraftService, transitItemService, stepService, stopService, actionService } = services

        // 1. Initiate
        this.logger.info('1. Initiating Order Draft...')
        const order = await orderDraftService.initiateOrder(clientId, { ref_id: `ATOMIC-${Date.now()}` })
        this.logger.info(`   Draft created: ${order.id}`)
        await waitHere(200)

        // 2. Add Transit Item
        this.logger.info('2. Adding Transit Item...')
        const item = await transitItemService.addTransitItem(order.id, clientId, {
            name: 'Colis Fragile',
            weight: 2.5,
            packaging_type: 'box'
        })
        this.logger.info(`   Item added: ${item.entity.id}`)
        await waitHere(200)

        // 3. Add Step
        this.logger.info('3. Adding Step...')
        const step = await stepService.addStep(order.id, clientId, { sequence: 0 })
        this.logger.info(`   Step added: ${step.entity.id}`)
        await waitHere(200)

        // 4. Add First Stop (Pickup)
        this.logger.info('4. Adding Pickup Stop...')
        const stop1 = await stopService.addStop(step.entity.id, clientId, {
            address_text: '123 Rue de la Paix, Abidjan',
            coordinates: [-4.0083, 5.3245],
            display_order: 0
        })
        this.logger.info(`   Pickup stop added: ${stop1.entity.id}`)
        await waitHere(200)

        // 5. Add Action to Stop 1
        this.logger.info('5. Adding Pickup Action...')
        await actionService.addAction(stop1.entity.id, clientId, {
            type: 'pickup',
            transit_item_id: item.entity.id,
            quantity: 1
        })
        this.logger.info('   Action added.')
        await waitHere(200)

        // 6. Add Second Stop (Delivery)
        this.logger.info('6. Adding Delivery Stop...')
        const stop2 = await stopService.addStop(step.entity.id, clientId, {
            address_text: '456 Boulevard Latrille, Abidjan',
            coordinates: [-3.9852, 5.3481],
            display_order: 1
        })
        this.logger.info(`   Delivery stop added: ${stop2.entity.id}`)
        await waitHere(200)

        // 7. Add Action to Stop 2
        this.logger.info('7. Adding Delivery Action...')
        await actionService.addAction(stop2.entity.id, clientId, {
            type: 'delivery',
            transit_item_id: item.entity.id,
            quantity: 1
        })
        this.logger.info('   Action added.')
        await waitHere(200)

        // 8. Submit
        this.logger.info('8. Submitting Order...')
        const finalized = await orderDraftService.submitOrder(order.id, clientId)
        this.logger.success(`   Order submitted! Status: ${finalized.status}, Total: ${finalized.pricingData?.total_amount} XOF`)
    }

    /**
     * Test 2: Bulk creation (All at once)
     */
    private async runBulkFlow(clientId: string, orderService: OrderService) {
        this.logger.info('\n--- [SCENARIO 2: BULK FLOW] ---')

        const payload = {
            ref_id: `BULK-${Date.now()}`,
            transit_items: [
                { id: 'temp-item-1', name: 'Pizza Large', weight: 0.8, packaging_type: 'box' }
            ],
            steps: [
                {
                    sequence: 0,
                    stops: [
                        {
                            address_text: 'Pizza Hut Plateau',
                            coordinates: [-4.0173, 5.3195],
                            display_order: 0,
                            actions: [
                                { type: 'pickup', transit_item_id: 'temp-item-1', quantity: 1 }
                            ]
                        },
                        {
                            address_text: 'Cocody Riviera 3',
                            coordinates: [-3.9482, 5.3411],
                            display_order: 1,
                            actions: [
                                { type: 'delivery', transit_item_id: 'temp-item-1', quantity: 1 }
                            ]
                        }
                    ]
                }
            ]
        }

        this.logger.info('Executing Bulk Order Creation...')
        const order = await orderService.createOrder(clientId, payload)

        this.logger.success(`   Bulk Order created & submitted! ID: ${order.id}`)
        this.logger.info(`   Status: ${order.status}`)
    }

    /**
     * Test 3: Complex Multi-Step scenario
     */
    private async runComplexScenario(clientId: string, services: any) {
        this.logger.info('\n--- [SCENARIO 3: COMPLEX MULTI-STEP] ---')
        const { orderDraftService, transitItemService, stepService, stopService, actionService } = services

        // 1. Initiate
        this.logger.info('1. Initiating Complex Order...')
        const order = await orderDraftService.initiateOrder(clientId, { ref_id: `COMPLEX-${Date.now()}` })
        await waitHere(200)

        // 2. Add multiple items
        const item1 = await transitItemService.addTransitItem(order.id, clientId, { name: 'Item A', weight: 1 })
        const item2 = await transitItemService.addTransitItem(order.id, clientId, { name: 'Item B', weight: 1 })
        await waitHere(200)

        // 3. Step 1: Pickup Item A
        const st1 = await stepService.addStep(order.id, clientId, { sequence: 0 })
        const stopA1 = await stopService.addStop(st1.entity.id, clientId, { address_text: 'Point A1', coordinates: [-4.0, 5.3], display_order: 0 })
        await actionService.addAction(stopA1.entity.id, clientId, { type: 'pickup', transit_item_id: item1.entity.id, quantity: 1 })
        await waitHere(200)

        // 4. Step 2: Pickup Item B AND Deliver Item A
        const st2 = await stepService.addStep(order.id, clientId, { sequence: 1 })
        const stopB1 = await stopService.addStop(st2.entity.id, clientId, { address_text: 'Point B1', coordinates: [-4.1, 5.4], display_order: 0 })

        // Delivery A
        await actionService.addAction(stopB1.entity.id, clientId, { type: 'delivery', transit_item_id: item1.entity.id, quantity: 1 })
        // Pickup B
        await actionService.addAction(stopB1.entity.id, clientId, { type: 'pickup', transit_item_id: item2.entity.id, quantity: 1 })
        await waitHere(200)

        // 5. Step 3: Deliver Item B
        const st3 = await stepService.addStep(order.id, clientId, { sequence: 2 })
        const stopB2 = await stopService.addStop(st3.entity.id, clientId, { address_text: 'Point B2', coordinates: [-4.2, 5.5], display_order: 0 })
        await actionService.addAction(stopB2.entity.id, clientId, { type: 'delivery', transit_item_id: item2.entity.id, quantity: 1 })
        await waitHere(200)

        // 6. Submit
        this.logger.info('Submitting Complex Order...')
        const finalized = await orderDraftService.submitOrder(order.id, clientId)
        this.logger.success(`   Complex Order submitted! Status: ${finalized.status}`)
    }

    /**
     * Test 4: Modification scenario (Shadows/Clones)
     */
    private async runModificationScenario(clientId: string, services: any, orderService: OrderService) {
        this.logger.info('\n--- [SCENARIO 4: MODIFICATION FLOW (SHADOWS)] ---')
        const { orderDraftService, transitItemService, stepService, stopService, actionService } = services

        // 1. Create a stable order
        this.logger.info('1. Creating a stable order...')
        const order = await orderDraftService.initiateOrder(clientId, { ref_id: `MODIF-${Date.now()}` })
        const item = await transitItemService.addTransitItem(order.id, clientId, { name: 'Item X', weight: 1 })
        const st1 = await stepService.addStep(order.id, clientId, { sequence: 0 })
        const stop1 = await stopService.addStop(st1.entity.id, clientId, { address_text: 'Original Pickup', coordinates: [-4.0, 5.3], display_order: 0 })
        await actionService.addAction(stop1.entity.id, clientId, { type: 'pickup', transit_item_id: item.entity.id, quantity: 1 })
        const stop2 = await stopService.addStop(st1.entity.id, clientId, { address_text: 'Original Delivery', coordinates: [-4.1, 5.4], display_order: 1 })
        await actionService.addAction(stop2.entity.id, clientId, { type: 'delivery', transit_item_id: item.entity.id, quantity: 1 })

        const submitted = await orderDraftService.submitOrder(order.id, clientId)
        this.logger.info(`   Order submitted. Status: ${submitted.status}`)

        // 2. Modify the Pickup Stop (Change address)
        this.logger.info('2. Modifying Pickup Stop (Address change)...')
        const modStop1 = await stopService.updateStop(stop1.entity.id, clientId, { address_text: 'Modified Pickup Address' })
        this.logger.info(`   Modification entity created: ${modStop1.entity.id} (Pending: ${modStop1.entity.isPendingChange})`)

        // 3. Mark the Delivery Stop for deletion and add a new one
        this.logger.info('3. Marking Delivery Stop for deletion and adding alternative...')
        await stopService.removeStop(stop2.entity.id, clientId)

        const stop3 = await stopService.addStop(st1.entity.id, clientId, { address_text: 'New Delivery Address', coordinates: [-4.2, 5.5], display_order: 2 })
        await actionService.addAction(stop3.entity.id, clientId, { type: 'delivery', transit_item_id: item.entity.id, quantity: 1 })

        // 4. Verify Client View
        this.logger.info('4. Verifying Client View (Virtual State)...')
        const fullOrder = await orderDraftService.getOrderDetails(order.id, clientId)
        const clientView = orderDraftService.buildVirtualState(fullOrder, { view: 'CLIENT' })

        const virtualStops = clientView.steps[0].stops
        this.logger.info(`   Stops in Client view: ${virtualStops.length}`)
        virtualStops.forEach((s: any) => this.logger.info(`     - ${s.address_text}`))

        // 5. Push Updates
        this.logger.info('5. Pushing Updates to Driver...')
        await orderService.pushUpdates(order.id, clientId)

        // 6. Verify Result
        const finalOrder = await orderDraftService.getOrderDetails(order.id, clientId)
        this.logger.success(`   Updates pushed! Status: ${finalOrder.status}`)
        this.logger.info(`   Final Stops: ${finalOrder.steps[0].stops.length}`)
        finalOrder.steps[0].stops.forEach((s: any) => this.logger.info(`     - ${s.address.formattedAddress}`))
    }
}
