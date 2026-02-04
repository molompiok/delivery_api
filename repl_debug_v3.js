const db = (await import('@adonisjs/lucid/services/db')).default
const fs = await import('node:fs')
const orderId = 'ord_mov6lfiwf291qbi21y'

const data = {
    items: await db.from('transit_items').where('order_id', orderId),
    steps: await db.from('steps').where('order_id', orderId),
    stops: await db.from('stops').where('order_id', orderId),
    actions: await db.from('actions').where('order_id', orderId)
}

fs.writeFileSync('debug_data.json', JSON.stringify(data, null, 2))
console.log('DEBUG_DATA_SAVED')
    .exit
