import db from '@adonisjs/lucid/services/db'
import Order from '#models/order'

async function debugOrder(orderId: string) {
    try {
        const order = await Order.find(orderId)
        if (!order) {
            console.log('Order not found')
            return
        }

        console.log('ORDER:', JSON.stringify({
            id: order.id,
            status: order.status,
            driverId: order.driverId,
            metadata: order.metadata
        }, null, 2))

        const remaining = order.metadata?.route_execution?.remaining
        console.log('REMAINING STOPS:', remaining)

        if (remaining && remaining.length > 0) {
            const nextStopId = remaining[0]
            const nextStop = await db.from('stops').where('id', nextStopId).first()
            console.log('NEXT STOP:', nextStop)
            if (nextStop) {
                const address = await db.from('addresses').where('id', nextStop.address_id).first()
                console.log('ADDRESS:', address)
            }
        }
    } catch (error) {
        console.error('ERROR:', error)
    }
}

const orderId = 'ord_o3it5lh68nuh3jq8n2'
debugOrder(orderId).then(() => process.exit(0))
