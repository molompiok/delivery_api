import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import Order from '#models/order'
import User from '#models/user'

export default class DeleteOpusOrders extends BaseCommand {
    static commandName = 'delete:opus_orders'
    static description = 'Deletes all orders associated with the user Opus'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('Searching for user Opus...')

        // Case insensitive search for safety
        const user = await User.query()
            .where('fullName', 'Opus')
            .orWhere('fullName', 'opus')
            .first()

        if (!user) {
            this.logger.error('User "Opus" not found!')
            return
        }

        this.logger.info(`Found user: ${user.fullName} (${user.id})`)

        const orders = await Order.query().where('clientId', user.id)

        if (orders.length === 0) {
            this.logger.info('No orders found for this user.')
            return
        }

        this.logger.info(`Found ${orders.length} orders. Deleting...`)

        let count = 0
        for (const order of orders) {
            await order.delete()
            count++
            this.logger.debug(`Deleted order ${order.id}`)
        }

        this.logger.success(`Successfully deleted ${count} orders for user Opus.`)
    }
}
