import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import env from '../../start/env.js'
import logger from '@adonisjs/core/services/logger'
import {
    VroomInput,
    VroomResult,
    VroomVehicle,
    VroomShipment,
    VroomJob
} from '../types/vroom.js'
import Task from '#models/task'
import Shipment from '#models/shipment'
import Job from '#models/job'
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
     * Builds VROOM input from our Cas G models.
     */
    async buildInput(
        vehicles: Vehicle[],
        shipments: Shipment[],
        jobs: Job[]
    ): Promise<{ input: VroomInput, idMapping: any }> {
        const vroomVehicles: VroomVehicle[] = []
        const vroomShipments: VroomShipment[] = []
        const vroomJobs: VroomJob[] = []

        const mapping = {
            tasks: new Map<number, string>(),
            vehicles: new Map<number, string>(),
            count: 1
        }

        // 1. Process Vehicles
        for (const vhc of vehicles) {
            const vroomVhcId = mapping.count++
            mapping.vehicles.set(vroomVhcId, vhc.id)

            // For start/end, we might need the actual address coordinates
            // Assuming driver current location or fixed depot
            // This is a placeholder logic:
            const vroomVhc: VroomVehicle = {
                id: vroomVhcId,
                description: `${vhc.brand} ${vhc.model}`,
                capacity: vhc.specs?.maxWeight ? [vhc.specs.maxWeight] : [1000],
                // start: [lon, lat],
                // end: [lon, lat],
            }
            vroomVehicles.push(vroomVhc)
        }

        // 2. Process Shipments
        for (const shp of shipments) {
            await shp.load('pickupTask')
            await shp.load('deliveryTask')

            const pTask = shp.pickupTask
            const dTask = shp.deliveryTask

            await pTask.load('address')
            await dTask.load('address')

            const vroomPId = mapping.count++
            const vroomDId = mapping.count++

            mapping.tasks.set(vroomPId, pTask.id)
            mapping.tasks.set(vroomDId, dTask.id)

            vroomShipments.push({
                description: `Shipment ${shp.id}`,
                pickup: {
                    id: vroomPId,
                    location: [pTask.address.lng, pTask.address.lat],
                    service: pTask.serviceTime
                },
                delivery: {
                    id: vroomDId,
                    location: [dTask.address.lng, dTask.address.lat],
                    service: dTask.serviceTime
                },
                priority: 1 // Default
            })
        }

        // 3. Process Jobs
        for (const job of jobs) {
            await job.load('task')
            const task = job.task
            await task.load('address')

            const vroomJobId = mapping.count++
            mapping.tasks.set(vroomJobId, task.id)

            vroomJobs.push({
                id: vroomJobId,
                description: `Job ${job.id}`,
                location: [task.address.lng, task.address.lat],
                service: task.serviceTime,
                priority: 1
            })
        }

        return {
            input: {
                vehicles: vroomVehicles,
                shipments: vroomShipments,
                jobs: vroomJobs
            },
            idMapping: {
                tasks: Object.fromEntries(mapping.tasks),
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

            // 1. Find or create the mission for this vehicle
            // In a real scenario, we might need to link it to the specific order(s)
            // For now, we assume missions are managed per-driver/vehicle

            // 2. Update Tasks in sequence
            let sequence = 0
            for (const step of route.steps) {
                if (step.type === 'start' || step.type === 'end' || step.type === 'break') continue

                const taskId = mapping.tasks[step.id!]
                if (taskId) {
                    const task = await Task.find(taskId)
                    if (task) {
                        task.sequence = sequence++
                        task.arrivalTime = step.arrival ? DateTime.now().plus({ seconds: step.arrival }) : null
                        // If we have multiple missions, we would assign task.missionId here
                        await task.save()
                    }
                }
            }
        }
    }
}
