import emitter from '@adonisjs/core/services/emitter'
import OrderStatusUpdated from '#events/order_status_updated'
import MissionOffered from '#events/mission_offered'

const OrderSocketListener = () => import('#listeners/order_socket_listener')
const MissionSocketListener = () => import('#listeners/mission_socket_listener')

emitter.on(OrderStatusUpdated, [OrderSocketListener, 'onOrderStatusUpdated'])
emitter.on(MissionOffered, [MissionSocketListener, 'onMissionOffered'])
