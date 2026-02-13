import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { inject } from '@adonisjs/core'

@inject()
export default class FixOrderAboisso extends BaseCommand {
    static commandName = 'fix:order:aboisso'
    static description = 'Remove incorrect Aboisso Comoe stop from order ord_e84lr3yu51anhsdyi6'

    static options: CommandOptions = {
        startApp: false
    }

    async run() {
        this.logger.info('Starting Fix for Aboisso...')

        await this.app.boot()
        const db = await this.app.container.make('lucid.db')
        const Order = (await import('#models/order')).default
        const OrderService = (await import('#services/order/index')).default

        const orderService = await this.app.container.make(OrderService)

        const trx = await db.transaction()

        try {
            const orderId = 'ord_e84lr3yu51anhsdyi6'

            // 1. Fetch Order and Stops
            const order = await Order.findOrFail(orderId, { client: trx })
            await order.load('steps', (q) => q.preload('stops', (sq) => sq.preload('address')))

            this.logger.info(`Order loaded: ${order.id} (Client: ${order.clientId})`)

            // 2. List all stops to debug
            const allStops = order.steps.flatMap(s => s.stops || [])
            this.logger.info(`Total stops: ${allStops.length}`)
            allStops.forEach(s => {
                this.logger.info(`- ID: ${s.id}, Display: ${s.displayOrder}, Addr: ${s.address?.street}, Formatted: ${s.address?.formattedAddress}`)
            })

            // Try looser search
            const targetStops = allStops.filter(s =>
                (s.address?.street || '').toLowerCase().includes('aboisso') ||
                (s.address?.formattedAddress || '').toLowerCase().includes('aboisso')
            )

            if (targetStops.length === 0) {
                this.logger.error('No stop found with "Aboisso"')
                await trx.rollback()
                return
            }

            this.logger.info(`Found ${targetStops.length} stops matching "Aboisso Comoe":`)
            targetStops.forEach(s => {
                this.logger.info(`- ID: ${s.id}, Exec: ${s.executionOrder}, Display: ${s.displayOrder}, Addr: ${s.address?.street}`)
            })

            const stopToDelete = targetStops.sort((a, b) => b.displayOrder - a.displayOrder)[0]

            if (!stopToDelete) {
                this.logger.error('Could not identify stop to delete')
                await trx.rollback()
                return
            }

            this.logger.warning(`Deleting stop: ${stopToDelete.id} (${stopToDelete.address?.street})`)

            // 4. Remove via Service
            await orderService.removeStop(stopToDelete.id, order.clientId, { trx })

            this.logger.success('Stop deleted successfully via OrderService.')

            await trx.commit()
            this.logger.info('Transaction committed.')

        } catch (error) {
            this.logger.error('FIX FAILED')
            this.logger.error(error)
            await trx.rollback()
        }
    }
}
