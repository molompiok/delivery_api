import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { inject } from '@adonisjs/core'

@inject()
export default class ValidateVroomCache extends BaseCommand {
    static commandName = 'validate:vroom'
    static description = 'Validate VROOM Integration, Cache and Recalculation logic'

    static options: CommandOptions = {
        startApp: false
    }

    async run() {
        await this.app.boot()

        const db = await this.app.container.make('lucid.db')
        const User = (await import('#models/user')).default
        const OrderDraftService = (await import('#services/order/order_draft_service')).default
        const StopService = (await import('#services/order/stop_service')).default
        const ActionService = (await import('#services/order/action_service')).default
        const TransitItemService = (await import('#services/order/transit_item_service')).default

        const orderDraftService = await this.app.container.make(OrderDraftService)
        const stopService = await this.app.container.make(StopService)
        const actionService = await this.app.container.make(ActionService)
        const transitItemService = await this.app.container.make(TransitItemService)

        this.logger.info('Starting VROOM & Cache Validation...')

        const trx = await db.transaction()

        try {
            // 1. Setup
            const clientUser = await User.findOrFail('usr_ff2u5koqimaq025q9u', { client: trx })

            // 2. Create Order
            this.logger.info('Initiating draft order...')
            const order = await orderDraftService.initiateOrder(clientUser.id, { ref_id: 'VROOM-CACHE-TEST' }, trx)
            const stepId = order.steps[0].id

            // 3. Add Stops
            this.logger.info('Adding stops...')
            await stopService.addStop(stepId, clientUser.id, {
                address: { street: 'Abidjan Plateau', lat: 5.308, lng: -4.016 }
            }, trx)

            const stop2Res = await stopService.addStop(stepId, clientUser.id, {
                address: { street: 'Cocody Riviera', lat: 5.348, lng: -4.016 }
            }, trx)
            const stop2Id = stop2Res.entity!.id

            // 4. Add Action and Item
            this.logger.info('Adding item and pickup action...')
            const itemRes = await transitItemService.addTransitItem(order.id, clientUser.id, {
                name: 'Test Item',
                weight: 100
            }, trx)
            const item1Id = itemRes.entity!.id

            await actionService.addAction(stop2Id, clientUser.id, {
                type: 'pickup',
                quantity: 1,
                transit_item_id: item1Id
            }, trx)

            // 5. First Call (Miss)
            this.logger.info('--- Step 1: Initial Calculation (Cache Miss Expected) ---')
            const start1 = Date.now()
            const res1 = await orderDraftService.getOrderDetails(order.id, clientUser.id, { trx })
            const duration1 = Date.now() - start1

            if (!res1.pending_route) throw new Error('First call failed: No pending_route')
            this.logger.info(`Duration: ${duration1}ms`)
            this.logger.success('Initial route calculated')

            // 6. Second Call (Hit)
            this.logger.info('--- Step 2: Identical Calculation (Cache Hit Expected) ---')
            const start2 = Date.now()
            await orderDraftService.getOrderDetails(order.id, clientUser.id, { trx })
            const duration2 = Date.now() - start2

            this.logger.info(`Duration: ${duration2}ms`)
            if (duration2 > duration1 * 0.5) {
                this.logger.warning('Warning: Cache speedup less than 50% (might be VROOM speed variance or small problem size)')
            } else {
                this.logger.success('Cache Hit likely (significant speedup)')
            }

            // 7. Modification (Recalculate)
            this.logger.info('--- Step 3: Modification (Recalculation Expected) ---')
            // Change item weight -> should change VroomInput hash
            await transitItemService.updateTransitItem(item1Id, clientUser.id, { weight: 500 }, trx)

            const start3 = Date.now()
            const res3 = await orderDraftService.getOrderDetails(order.id, clientUser.id, { trx })
            const duration3 = Date.now() - start3

            this.logger.info(`Duration: ${duration3}ms`)

            // Re-fetch res3 details
            const pendingWeight = res3.pending_route.summary.amount[0]
            if (pendingWeight !== 500) {
                throw new Error(`Recalculation failed: Expected weight 500 in VROOM summary, got ${pendingWeight}`)
            }
            this.logger.success('Data modification triggered correct re-calculation')

            // 8. Validation of VROOM Result details
            this.logger.info('--- Step 4: Verification of VROOM Data ---')
            if (!res3.pending_route.geometry || res3.pending_route.geometry.type !== 'LineString') {
                throw new Error('VROOM Result: Missing or invalid geometry')
            }
            // Count jobs in VroomInput would be 2 stops
            if (res3.pending_route.stops.length < 2) {
                throw new Error(`VROOM Result: Expected at least 2 stops, got ${res3.pending_route.stops.length}`)
            }
            this.logger.success('VROOM data structure verified')

        } catch (error) {
            this.logger.error('VALIDATION FAILED')
            this.logger.error(error)
        } finally {
            this.logger.warning('Cleaning up (Rolling back test transaction)...')
            await trx.rollback()
            this.logger.info('Done.')
        }
    }
}
