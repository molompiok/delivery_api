import db from '@adonisjs/lucid/services/db'
import Order from '#models/order'

async function debugOrder(orderId) {
    console.log(`--- Debugging Order: ${orderId} ---`)

    const order = await Order.query()
        .where('id', orderId)
        .preload('transitItems')
        .preload('steps', (q) => q.preload('stops', (sq) => sq.preload('actions')))
        .first()

    if (!order) {
        console.log('Order not found')
        return
    }

    console.log(`Status: ${order.status}`)
    console.log(`Has Pending Changes: ${order.hasPendingChanges}`)

    console.log('\n--- Steps & Stops (Hierarchy) ---')
    order.steps.forEach(step => {
        console.log(`\nStep ID: ${step.id} (Seq: ${step.sequence}, Pending: ${step.isPendingChange}, Delete: ${step.isDeleteRequired}, Original: ${step.originalId})`)
        step.stops.forEach(stop => {
            console.log(`  Stop ID: ${stop.id} (Seq: ${stop.sequence}, Pending: ${stop.isPendingChange}, Delete: ${stop.isDeleteRequired}, Original: ${stop.originalId})`)
            stop.actions.forEach(action => {
                console.log(`    Action ID: ${action.id} (Type: ${action.type}, Item: ${action.transitItemId}, Pending: ${action.isPendingChange}, Delete: ${action.isDeleteRequired}, Original: ${action.originalId})`)
            })
        })
    })

    console.log('\n--- Transit Items ---')
    order.transitItems.forEach(ti => {
        console.log(`ID: ${ti.id}, Name: ${ti.name}`)
    })

    const referencedIdsInDB = new Set()
    order.steps.forEach(step => {
        step.stops.forEach(stop => {
            stop.actions.forEach(action => {
                if (action.transitItemId) referencedIdsInDB.add(action.transitItemId)
            })
        })
    })

    const unusedInDB = order.transitItems.filter(ti => !referencedIdsInDB.has(ti.id))
    console.log('\n--- Unused Items (FULL DB view - including shadows and originals) ---')
    unusedInDB.forEach(ti => console.log(`ID: ${ti.id}, Name: ${ti.name}`))
}

const orderId = 'ord_mov6lfiwf291qbi21y'
debugOrder(orderId).then(() => process.exit(0)).catch(err => {
    console.error(err)
    process.exit(1)
})
