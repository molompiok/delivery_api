import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { inject } from '@adonisjs/core'

@inject()
export default class TestRouteAppend extends BaseCommand {
    static commandName = 'test:route:append'
    static description = 'Test if adding a stop inserts it optimally or appends it'

    static options: CommandOptions = {
        startApp: false
    }

    async run() {
        this.logger.info('Starting Route Append Test...')

        await this.app.boot()
        const db = await this.app.container.make('lucid.db')
        const User = (await import('#models/user')).default
        const OrderService = (await import('#services/order/index')).default
        const OrderDraftService = (await import('#services/order/order_draft_service')).default

        const orderService = await this.app.container.make(OrderService)
        const orderDraftService = await this.app.container.make(OrderDraftService)

        const trx = await db.transaction()

        try {
            // 1. Setup User
            const clientUser = await User.findOrFail('usr_ff2u5koqimaq025q9u', { client: trx })
            this.logger.success(`User loaded: ${clientUser.email}`)

            // 2. Initiate Order
            const order = await orderService.initiateOrder(clientUser.id, {}, trx)
            const stepId = order.steps[0].id

            // 3. Add Initial Stops: Bingerville -> Grand-Bassam
            // Start (Implicit Cocody): 5.350, -3.967

            this.logger.info('--- Step 1: Add Stops (Bingerville, Bassam) ---')

            // Stop 1: Bingerville (East)
            const stop1 = await orderService.addStop(stepId, clientUser.id, {
                address: { street: 'Bingerville', lat: 5.352, lng: -3.885 },
                actions: [{ type: 'SERVICE', quantity: 0 }]
            }, { trx })
            this.logger.info(`Added Bingerville: ${stop1.entity.id}`)

            // Stop 2: Grand-Bassam (Far South-East)
            const stop2 = await orderService.addStop(stepId, clientUser.id, {
                address: { street: 'Grand-Bassam', lat: 5.200, lng: -3.730 },
                actions: [{ type: 'SERVICE', quantity: 0 }]
            }, { trx })
            this.logger.info(`Added Bassam: ${stop2.entity.id}`)

            // Check initial route
            let routeInitial = await orderDraftService.getRoute(order.id, clientUser.id, { live: false, pending: true, force: true }, trx)
            // const seq1 = routeInitial.pending_route.stops.map((s: any) => s.address_text)
            // this.logger.info(`Initial Sequence: ${seq1.join(' -> ')}`)

            // 4. Add "Palmeraie" (Between Cocody and Bingerville)
            // Palmeraie: 5.360, -3.950
            this.logger.info('--- Step 2: Add Palmeraie (Between Start and Bingerville) ---')

            const stop3 = await orderService.addStop(stepId, clientUser.id, {
                address: { street: 'Palmeraie', lat: 5.360, lng: -3.950 },
                actions: [{ type: 'SERVICE', quantity: 0 }]
            }, { trx })
            this.logger.info(`Added Palmeraie: ${stop3.entity.id}`)

            // 5. Check Final Route
            let routeFinal = await orderDraftService.getRoute(order.id, clientUser.id, { live: false, pending: true, force: true }, trx)
            const seqIds = routeFinal.pending_route.stops.map((s: any) => s.stopId)
            this.logger.info(`Final Sequence (IDs): ${seqIds.join(' -> ')}`)

            // 6. Validation
            const palmeraieIndex = seqIds.indexOf(stop3.entity.id)
            const bingervilleIndex = seqIds.indexOf(stop1.entity.id)
            const bassamIndex = seqIds.indexOf(stop2.entity.id)

            this.logger.info(`Indices: Palm=${palmeraieIndex}, Bing=${bingervilleIndex}, Bass=${bassamIndex}`)

            // Check if Palmeraie is NOT the last stop (meaning it was inserted, not appended)
            // Expectation: Bing -> Palm -> Bass (Palm is 1, Bass is 2) OR Palm -> Bing -> Bass
            // In both optimal cases, Bassam should be last (as it is furthest).

            const lastIndex = seqIds.length - 1
            if (palmeraieIndex !== -1 && palmeraieIndex < lastIndex) {
                this.logger.success(`PASS: Palmeraie inserted at index ${palmeraieIndex} (Not Last)!`)
                if (palmeraieIndex > bingervilleIndex) {
                    this.logger.info('Note: Palmeraie is after Bingerville (Optimal for road network).')
                }
            } else {
                this.logger.error('FAIL: Palmeraie is the LAST stop (Appended).')
            }

        } catch (error) {
            this.logger.error(error)
        } finally {
            await trx.rollback()
        }
    }
}
