import emitter from '@adonisjs/core/services/emitter'
import OrderStatusUpdated from '#events/order_status_updated'
import StopStatusUpdated from '#events/stop_status_updated'
import ActionStatusUpdated from '#events/action_status_updated'
import OrderStructureChanged from '#events/order_structure_changed'
import MissionOffered from '#events/mission_offered'

/**
 * Registering events for type-safety
 */
declare module '@adonisjs/core/types' {
    interface EventsList {
        'order:status_updated': OrderStatusUpdated
        'stop:status_updated': StopStatusUpdated
        'action:status_updated': ActionStatusUpdated
        'order:structure_changed': OrderStructureChanged
        'mission:offered': MissionOffered
    }
}

const OrderSocketListener = () => import('#listeners/order_socket_listener')
const MissionSocketListener = () => import('#listeners/mission_socket_listener')

emitter.on(OrderStatusUpdated, [OrderSocketListener, 'onOrderStatusUpdated'])
emitter.on(StopStatusUpdated, [OrderSocketListener, 'onStopStatusUpdated'])
emitter.on(ActionStatusUpdated, [OrderSocketListener, 'onActionStatusUpdated'])
emitter.on(OrderStructureChanged, [OrderSocketListener, 'onOrderStructureChanged'])
emitter.on(MissionOffered, [MissionSocketListener, 'onMissionOffered'])
