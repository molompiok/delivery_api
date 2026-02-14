
import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import Order from '#models/order'

export default class FindInvalidStop extends BaseCommand {
    static commandName = 'find:invalid-stop'
    static description = 'Finds discrepancies in stops and coordinates'

    static options: CommandOptions = {
        startApp: true
    }

    async run() {
        const orderId = 'ord_e84lr3yu51anhsdyi6'

        this.logger.info(`Fetching order ${orderId} and its stops...`)
        const order = await Order.query()
            .where('id', orderId)
            .preload('steps', (q) => q.preload('stops', (sq) => sq.preload('address')))
            .preload('stops', (q) => q.preload('address'))
            .first()

        if (!order) {
            this.logger.error('Order not found')
            return
        }

        this.logger.info(`Metadata: ${JSON.stringify(order.metadata?.route_execution, null, 2)}`)

        const stopsFromSteps = order.steps.flatMap(s => s.stops || [])
        const allStopsInOrder = order.stops || []

        this.logger.info(`Stops from steps: ${stopsFromSteps.length}`)
        this.logger.info(`Total stops in order: ${allStopsInOrder.length}`)

        const visitedIds = new Set(order.metadata?.route_execution?.visited || [])

        for (const stop of allStopsInOrder) {
            const isInStep = stopsFromSteps.some(s => s.id === stop.id)
            const isVisited = visitedIds.has(stop.id)
            const hasCoords = !!stop.address && stop.address.lat !== null && stop.address.lng !== null

            this.logger.info(`[STOP] ${stop.id} | InStep: ${isInStep} | Visited: ${isVisited} | Coords: ${hasCoords} | Status: ${stop.status}`)
            if (!hasCoords || !isInStep) {
                this.logger.warning(`WEIRD STOP: ${stop.id}`)
            }
            console.log(`--- JSON START ${stop.id} ---`)
            console.log(JSON.stringify(stop.toJSON(), null, 2))
            console.log(`--- JSON END ${stop.id} ---`)
        }
    }
}
