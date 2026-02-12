import { BaseCommand } from '@adonisjs/core/ace'
import { inject } from '@adonisjs/core'

@inject()
export default class InspectOrder extends BaseCommand {
    static commandName = 'inspect:order'
    static description = 'Inspect order data for debugging'

    async run() {
        await this.app.boot()
        const Order = (await import('#models/order')).default
        const orderId = 'ord_f9xe4kynmqjjgileqg'

        const order = await Order.query()
            .where('id', orderId)
            .preload('steps', q => q.preload('stops', sq => sq.preload('address')))
            .first()

        if (!order) {
            this.logger.error('Order not found')
            return
        }

        this.logger.info(`Order ID: ${order.id}`)
        this.logger.info(`Status: ${order.status}`)

        const OrderDraftService = (await import('#services/order/order_draft_service')).default
        const orderDraftService = await this.app.container.make(OrderDraftService)
        const virtualState = orderDraftService.buildVirtualState(order, { view: 'CLIENT' })

        const VroomService = (await import('#services/vroom_service')).default
        const vroomService = await this.app.container.make(VroomService)

        const route = await vroomService.calculate(virtualState, order.vehicle)
        if (route && route.geometry) {
            this.logger.info(`Vroom Geometry Points: ${route.geometry.coordinates.length}`)
            this.logger.info(`First 5 points: ${JSON.stringify(route.geometry.coordinates.slice(0, 5))}`)
        } else {
            this.logger.warning('No Vroom Geometry returned')
        }
    }
}
