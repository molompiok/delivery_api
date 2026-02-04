const Order = (await import('#models/order')).default
const db = (await import('@adonisjs/lucid/services/db')).default
const orderId = 'ord_mov6lfiwf291qbi21y'
const order = await Order.find(orderId)
if (order) console.log('ORDER_DATA:', JSON.stringify(order.serialize()))
const items = await db.from('transit_items').where('order_id', orderId)
console.log('ITEMS_DATA:', JSON.stringify(items))
const steps = await db.from('steps').where('order_id', orderId)
console.log('STEPS_DATA:', JSON.stringify(steps))
const stops = await db.from('stops').where('order_id', orderId)
console.log('STOPS_DATA:', JSON.stringify(stops))
const actions = await db.from('actions').where('order_id', orderId)
console.log('ACTIONS_DATA:', JSON.stringify(actions))
    .exit
