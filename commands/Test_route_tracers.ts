import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { inject } from '@adonisjs/core'

@inject()
export default class TestRouteTracers extends BaseCommand {
    static commandName = 'test:route:tracers'
    static description = 'Test Advanced Route Ordering and Optimization'

    static options: CommandOptions = {
        startApp: false
    }

    async run() {
        this.logger.info('Starting Advanced Route Tracers Tests...')

        await this.app.boot()
        const db = await this.app.container.make('lucid.db')
        const User = (await import('#models/user')).default
        const Stop = (await import('#models/stop')).default
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
            this.logger.info('--- Step 1: Initiate Order ---')
            const order = await orderService.initiateOrder(clientUser.id, {}, trx)
            const stepId = order.steps[0].id

            // 3. Add Transit Items
            this.logger.info('--- Step 2: Add Transit Items ---')
            const resShoes = await orderService.addTransitItem(order.id, clientUser.id, { name: 'Chaussures', weight: 2 }, trx)
            const resBags = await orderService.addTransitItem(order.id, clientUser.id, { name: 'Sacs', weight: 1 }, trx)
            const resWatches = await orderService.addTransitItem(order.id, clientUser.id, { name: 'Montres', weight: 0.5 }, trx)

            const itemShoes = resShoes.entity!
            const itemBags = resBags.entity!
            const itemWatches = resWatches.entity!

            // 4. Add initial 4 stops in specific locations
            this.logger.info('--- Step 3: Add 4 Initial Stops ---')

            // Stop 1: Bingerville (Pickup Shoes +10)
            await orderService.addStop(stepId, clientUser.id, {
                address: { street: 'Bingerville', lat: 5.352, lng: -3.885 },
                actions: [{ type: 'PICKUP', transit_item_id: itemShoes.id, quantity: 10 }]
            }, { trx })

            // Stop 2: Bonoua (Deliver Shoes -5, Pickup Bags +2)
            await orderService.addStop(stepId, clientUser.id, {
                address: { street: 'Bonoua', lat: 5.274, lng: -3.595 },
                actions: [
                    { type: 'DELIVERY', transit_item_id: itemShoes.id, quantity: 5 },
                    { type: 'PICKUP', transit_item_id: itemBags.id, quantity: 2 }
                ]
            }, { trx })

            // Stop 3: Alépé (Deliver Shoes -5, Deliver Bags -2, Pickup Watches +3)
            await orderService.addStop(stepId, clientUser.id, {
                address: { street: 'Alépé', lat: 5.497, lng: -3.663 },
                actions: [
                    { type: 'DELIVERY', transit_item_id: itemShoes.id, quantity: 5 },
                    { type: 'DELIVERY', transit_item_id: itemBags.id, quantity: 2 },
                    { type: 'PICKUP', transit_item_id: itemWatches.id, quantity: 3 }
                ]
            }, { trx })

            // Stop 4: Anyama (Deliver Watches -3)
            await orderService.addStop(stepId, clientUser.id, {
                address: { street: 'Anyama', lat: 5.494, lng: -4.051 },
                actions: [{ type: 'DELIVERY', transit_item_id: itemWatches.id, quantity: 3 }]
            }, { trx, recalculate: true })

            // 5. Check Route before Submit
            this.logger.info('--- Step 4: Route before Submit ---')
            let routeBefore = await orderDraftService.getRoute(order.id, clientUser.id, { live: false, pending: true, force: true }, trx)
            const sequenceBefore = routeBefore.pending_route.stops.map((s: any) => s.stopId)

            for (const s of routeBefore.pending_route.stops) {
                const stopModel = await Stop.findOrFail(s.stopId, { client: trx })
                await stopModel.load('address')
                this.logger.info(`[Bef ${s.execution_order}] Stop: ${stopModel.address.street} (${stopModel.id}) - Lat: ${stopModel.address.lat}, Lng: ${stopModel.address.lng}, Display: ${s.display_order}`)
            }

            // 6. Submit Order
            this.logger.info('--- Step 5: Submit Order ---')
            await orderService.submitOrder(order.id, clientUser.id, trx)

            // 7. Scramble display_order
            this.logger.info('--- Step 6: Scramble display_order ---')
            const stops = await Stop.query({ client: trx }).where('orderId', order.id)
            // Shuffle
            const scrambleMap: Record<number, number> = { 0: 2, 1: 3, 2: 0, 3: 1 }
            for (let i = 0; i < stops.length; i++) {
                stops[i].displayOrder = scrambleMap[i] ?? i
                await stops[i].useTransaction(trx).save()
            }

            // 8. Verify Route remains same after scramble
            this.logger.info('--- Step 7: Verify Route after Scramble ---')
            let routeAfter = await orderDraftService.getRoute(order.id, clientUser.id, { live: true, pending: false, force: true }, trx)
            const sequenceAfter = routeAfter.live_route.stops.map((s: any) => s.stopId)

            if (JSON.stringify(sequenceBefore) === JSON.stringify(sequenceAfter)) {
                this.logger.success('Optimization is independent of display_order!')
            } else {
                this.logger.error('Optimization FAILED: Sequence changed after display_order scramble!')
                this.logger.info(`Before: ${sequenceBefore.join(',')}`)
                this.logger.info(`After : ${sequenceAfter.join(',')}`)
            }

            // 9. Add interleaved service stops
            this.logger.info('--- Step 8: Add Interleaved Services ---')

            await orderService.addStop(stepId, clientUser.id, {
                address: { street: 'Bingerville (Service 1)', lat: 5.352, lng: -3.885 },
                actions: [{ type: 'SERVICE', quantity: 0 }]
            }, { trx })

            await orderService.addStop(stepId, clientUser.id, {
                address: { street: 'San-Pédro (Service 2 - FAR)', lat: 4.750, lng: -6.600 },
                actions: [{ type: 'SERVICE', quantity: 0 }]
            }, { trx })

            await orderService.addStop(stepId, clientUser.id, {
                address: { street: 'Bonoua (Service 3)', lat: 5.274, lng: -3.595 },
                actions: [{ type: 'SERVICE', quantity: 0 }]
            }, { trx })

            await orderService.addStop(stepId, clientUser.id, {
                address: { street: 'Anyama (Service 4)', lat: 5.494, lng: -4.051 },
                actions: [{ type: 'SERVICE', quantity: 0 }]
            }, { trx, recalculate: true })

            // 10. Check Final Optimized Route
            this.logger.info('--- Step 9: Final Route with Services ---')
            const finalRoute = await orderDraftService.getRoute(order.id, clientUser.id, { live: true, pending: true, force: true }, trx)

            this.logger.info('Final optimized stops sequence:')
            const finalStops = finalRoute.pending_route.stops
            for (const s of finalStops) {
                const stopModel = await Stop.findOrFail(s.stopId, { client: trx })
                await stopModel.load('address')
                this.logger.info(`[Exec ${s.execution_order}] Stop: ${stopModel.address.street} (${stopModel.id})`)
            }

            const lastStopId = finalStops[finalStops.length - 1].stopId
            const lastStop = await Stop.findOrFail(lastStopId, { client: trx })
            await lastStop.load('address')

            if (lastStop.address.street?.includes('San-Pédro')) {
                this.logger.success('Service 2 (San-Pédro) is correctly placed at the end due to distance!')
            } else {
                this.logger.error(`San-Pédro is NOT the last stop! Last stop is: ${lastStop.address.street}`)
            }

            this.logger.success('All Advanced Tracer Tests Passed!')

        } catch (error) {
            this.logger.error('TEST FAILED')
            this.logger.error(error)
        } finally {
            this.logger.warning('Rolling back transaction...')
            await trx.rollback()
            this.logger.info('Done.')
        }
    }
}
