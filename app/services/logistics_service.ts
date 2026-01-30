import Task from '#models/task'
import Shipment from '#models/shipment'
import logger from '@adonisjs/core/services/logger'

export default class LogisticsService {
    /**
     * Validates if a sequence of tasks is logically sound.
     * Rule: Pickup of a shipment must precede its delivery.
     */
    static validateTaskSequence(tasks: Task[], shipments: Shipment[]): boolean {
        const taskOrderMap = new Map<string, number>()
        tasks.forEach((t, index) => {
            if (t.id) taskOrderMap.set(t.id, index)
        })

        for (const shp of shipments) {
            const pIndex = taskOrderMap.get(shp.pickupTaskId)
            const dIndex = taskOrderMap.get(shp.deliveryTaskId)

            if (pIndex === undefined || dIndex === undefined) {
                logger.warn({ shipmentId: shp.id }, 'Missing task in sequence for shipment validation')
                continue
            }

            if (pIndex >= dIndex) {
                logger.error({
                    shipmentId: shp.id,
                    pickupIndex: pIndex,
                    deliveryIndex: dIndex
                }, 'Constraint violation: Delivery before Pickup')
                return false
            }
        }

        return true
    }

    /**
     * Calculates the actual load of a vehicle at any given step.
     */
    static calculateLoadProgression(tasks: Task[]): number[] {
        // Placeholder for weight/volume calculation
        // For now, assume each pickup adds 1 and each delivery removes 1
        let currentLoad = 0
        const progression: number[] = []

        for (const task of tasks) {
            if (task.type === 'PICKUP') currentLoad++
            if (task.type === 'DELIVERY') currentLoad--
            progression.push(currentLoad)
        }

        return progression
    }
}
