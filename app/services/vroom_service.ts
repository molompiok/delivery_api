import env from '../../start/env.js'
import logger from '@adonisjs/core/services/logger'
import {
    VroomInput,
    VroomResult,
    VroomVehicle,
    VroomShipment,
    VroomJob
} from '../types/vroom.js'
import Stop from '#models/stop'
import Vehicle from '#models/vehicle'

export default class VroomService {
    private vroomUrl = env.get('VROOM_URL', 'http://localhost:5000')

    /**
     * Sends a request to VROOM to solve a VRP.
     */
    async solve(input: VroomInput): Promise<VroomResult | null> {
        try {
            const response = await fetch(`${this.vroomUrl}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...input,
                    options: { g: true, ...input.options }
                }),
            })

            if (!response.ok) {
                const errorData = await response.text()
                logger.error({ status: response.status, data: errorData }, 'VROOM API error')
                return null
            }

            return await response.json() as VroomResult
        } catch (error) {
            logger.error({ err: error }, 'Error calling VROOM')
            return null
        }
    }

    /**
     * Builds VROOM input from our New Action-Stop models.
     * Note: In the new model, we group Actions by Stop.
     */
    async buildInput(
        vehicles: Vehicle[],
        stops: Stop[]
    ): Promise<{ input: VroomInput, idMapping: any }> {
        const vroomVehicles: VroomVehicle[] = []
        const vroomShipments: VroomShipment[] = []
        const vroomJobs: VroomJob[] = []

        const mapping = {
            stops: new Map<number, string>(),
            vehicles: new Map<number, string>(),
            count: 1
        }

        // 1. Process Vehicles
        for (const vhc of vehicles) {
            const vroomVhcId = mapping.count++
            mapping.vehicles.set(vroomVhcId, vhc.id)

            const vroomVhc: VroomVehicle = {
                id: vroomVhcId,
                description: `${vhc.brand} ${vhc.model}`,
                capacity: vhc.specs?.maxWeight ? [vhc.specs.maxWeight] : [1000],
            }
            vroomVehicles.push(vroomVhc)
        }

        // 2. Process Stops as Jobs/Shipments
        // For simplicity in this v1 of Action-Stop conversion:
        // - PICKUP + DELIVERY combo for the same Item across two stops => VroomShipment
        // - Single stop SERVICE => VroomJob

        // This is a complex mapping because VROOM expects Shipments or Jobs.
        // For now, let's treat every Action as a Job if it's SERVICE or standalone,
        // but the goal is to group them.

        for (const stop of stops) {
            await stop.load('actions')
            await stop.load('address')

            const vroomStopId = mapping.count++
            mapping.stops.set(vroomStopId, stop.id)

            for (const action of stop.actions) {
                // If it's a service, it's definitely a Job
                if (action.type === 'SERVICE') {
                    vroomJobs.push({
                        id: vroomStopId,
                        description: `Action ${action.id}`,
                        location: [stop.address.lng, stop.address.lat],
                        service: action.serviceTime,
                        priority: 1
                    })
                } else {
                    // For PICKUP/DELIVERY, we could try to pair them into VroomShipments
                    // BUT VroomShipment requires two locations. 
                    // If we only have stops, we can treat them as Jobs with pickup/delivery amounts (VROOM supports this too)
                    vroomJobs.push({
                        id: vroomStopId,
                        description: `${action.type} ${action.id}`,
                        location: [stop.address.lng, stop.address.lat],
                        service: action.serviceTime,
                        amount: action.type === 'PICKUP' ? [action.quantity] : [-action.quantity],
                        priority: 1
                    })
                }
            }
        }

        return {
            input: {
                vehicles: vroomVehicles,
                shipments: vroomShipments,
                jobs: vroomJobs
            },
            idMapping: {
                stops: Object.fromEntries(mapping.stops),
                vehicles: Object.fromEntries(mapping.vehicles)
            }
        }
    }

    /**
     * Applies a VROOM solution to the database.
     * Updates Missions and Tasks with the optimized sequence.
     */
    async applySolution(result: VroomResult, mapping: any) {
        if (!result.routes) return

        for (const route of result.routes) {
            const vhcId = mapping.vehicles[route.vehicle]
            if (!vhcId) continue

            let sequence = 0
            for (const step of route.steps) {
                if (step.type === 'start' || step.type === 'end' || step.type === 'break') continue

                const stopId = mapping.stops[step.id!]
                if (stopId) {
                    const stop = await Stop.find(stopId)
                    if (stop) {
                        stop.sequence = sequence++
                        // On pourra aussi estimer l'heure d'arriv au stop
                        await stop.save()
                    }
                }
            }
        }
    }
}
