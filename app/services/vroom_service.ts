import env from '../../start/env.js'
import logger from '@adonisjs/core/services/logger'
import polyline from '@mapbox/polyline'
import {
    VroomInput,
    VroomResult,
    VroomVehicle,
    VroomJob
} from '../types/vroom.js'
import Stop from '#models/stop'
import Vehicle from '#models/vehicle'
import redis from '@adonisjs/redis/services/main'
import crypto from 'crypto'

export default class VroomService {
    private vroomUrl = env.get('VROOM_URL', 'http://localhost:5000')

    /**
     * Sends a request to VROOM to solve a VRP.
     * Caches the result in Redis using a hash of the input.
     */
    async solve(input: VroomInput): Promise<VroomResult | null> {
        const cacheKey = this.generateCacheKey(input)

        try {
            // Check cache
            const cachedResult = await redis.get(cacheKey)
            if (cachedResult) {
                logger.info({ cacheKey }, 'VROOM Cache Hit')
                return JSON.parse(cachedResult) as VroomResult
            }

            logger.info({ cacheKey }, 'VROOM Cache Miss')

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
                logger.error({ status: response.status, data: errorData, input }, 'VROOM API error')
                return null
            }

            const result = await response.json() as VroomResult

            // Store in cache for 30 minutes
            await redis.set(cacheKey, JSON.stringify(result), 'EX', 1800)

            return result
        } catch (error) {
            logger.error({ err: error, input }, 'Error calling VROOM')
            return null
        }
    }

    /**
     * Generates a unique cache key based on the VroomInput.
     */
    private generateCacheKey(input: VroomInput): string {
        const hash = crypto.createHash('sha256')
            .update(JSON.stringify(input))
            .digest('hex')
        return `vroom:cache:${hash}`
    }

    /**
     * Calculates an optimized route (geometry + stops order) from a virtual order state.
     */
    async calculate(state: any, vehicle?: Vehicle, options: { startLocation?: [number, number] } = {}): Promise<any> {
        const buildRes = await this.buildInputFromState(state, vehicle, options)
        if (!buildRes) return null

        const { input, idMapping } = buildRes
        const result = await this.solve(input)

        if (!result || !result.routes || result.routes.length === 0) {
            logger.warn({ orderId: state.id, result }, 'VROOM returned no routes or failed')
            return null
        }

        const route = result.routes[0]
        logger.info({ orderId: state.id, duration: route.duration, distance: route.distance }, 'VROOM Calculation Successful')

        // Decode VROOM geometry (Encoded Polyline) to GeoJSON LineString
        let geometry = null
        if (route.geometry) {
            // VROOM typically returns precision 5 for its polylines
            const decodedShape = polyline.decode(route.geometry, 5) as [number, number][]
            geometry = {
                type: 'LineString',
                coordinates: decodedShape.map(p => [p[1], p[0]]) // [lat, lon] -> [lon, lat]
            }
        }

        // Map VROOM steps back to our stop execution order
        const optimizedStops = route.steps
            .filter(s => s.type === 'job' || s.type === 'pickup' || s.type === 'delivery')
            .map((s, idx) => ({
                stopId: idMapping.stops[s.id!],
                execution_order: idx,
                arrival: s.arrival,
                arrival_time: this.formatSecondsToHm(s.arrival),
                duration: s.duration,
                distance: s.distance
            }))

        return {
            summary: result.summary,
            geometry: geometry,
            stops: optimizedStops,
            raw: route
        }
    }

    formatSecondsToHm(totalSeconds: number): string {
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const seconds = totalSeconds % 60

        const parts = []
        if (hours > 0) parts.push(`${hours}h`)
        if (minutes > 0) parts.push(`${minutes}min`)
        if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)

        return `{ ${parts.join(' , ')} }`
    }

    /**
     * Builds VROOM input from Virtual Order State.
     */
    async buildInputFromState(
        state: any,
        vehicle?: Vehicle,
        options: { startLocation?: [number, number] } = {}
    ): Promise<{ input: VroomInput, idMapping: any } | null> {
        const vroomVehicles: VroomVehicle[] = []
        const vroomJobs: VroomJob[] = []

        const mapping = {
            stops: new Map<number, string>(),
            count: 1
        }

        // 1. Process Vehicle
        // Determine start location: prioritize provided option, then first stop coordinates
        const startCoords = options.startLocation || state.steps?.[0]?.stops?.[0]?.coordinates

        if (!startCoords) {
            logger.warn({ orderId: state.id }, 'No start location provided for VROOM vehicle, and no stops found.')
        }

        vroomVehicles.push({
            id: 1,
            profile: 'auto',
            description: vehicle ? `${vehicle.brand} ${vehicle.model}` : 'Generic Vehicle',
            start: startCoords || undefined,
            capacity: vehicle?.specs?.maxWeight ? [vehicle.specs.maxWeight] : [2000000], // Default 2t if not specified
        })

        // 2. Map Stops as VROOM Jobs
        for (const step of state.steps) {
            for (const stop of step.stops) {
                const vroomStopId = mapping.count++
                mapping.stops.set(vroomStopId, stop.id)

                let totalServiceTime = 0
                let stopWeight = 0
                const stopSkills: number[] = []

                for (const action of stop.actions) {
                    totalServiceTime += action.service_time

                    const type = action.type?.toLowerCase()

                    if (action.transit_item_id) {
                        const item = state.transit_items?.find((ti: any) => ti.id === action.transit_item_id)
                        if (!item) {
                            logger.error({ stopId: stop.id, transitItemId: action.transit_item_id }, 'Transit item not found during VROOM input build')
                            throw new Error(`Transit item not found: ${action.transit_item_id}`)
                        }
                        if (item.weight) {
                            stopWeight += (type === 'pickup' ? item.weight : -item.weight)
                        }
                        // Mapping Requirements to Skills from Item Metadata
                        const requirements = item.metadata?.requirements || []
                        if (requirements.includes('froid')) stopSkills.push(1)
                        if (requirements.includes('chaud')) stopSkills.push(2)
                    }
                }

                vroomJobs.push({
                    id: vroomStopId,
                    description: `Stop ${stop.id}`,
                    location: stop.coordinates,
                    service: totalServiceTime,
                    amount: [stopWeight],
                    skills: stopSkills.length > 0 ? stopSkills : undefined,
                    time_windows: stop.opening_hours ? [[
                        Math.floor(new Date(stop.opening_hours.start).getTime() / 1000),
                        Math.floor(new Date(stop.opening_hours.end).getTime() / 1000)
                    ]] : undefined
                })
            }
        }

        return {
            input: {
                vehicles: vroomVehicles,
                jobs: vroomJobs,
                options: { g: true }
            },
            idMapping: {
                stops: Object.fromEntries(mapping.stops)
            }
        }
    }

    /**
     * Applies a VROOM solution to the database.
     * Updates Stop.executionOrder with the optimized sequence.
     * Does NOT touch displayOrder.
     */
    async applySolution(result: VroomResult, mapping: any) {
        if (!result.routes) return

        for (const route of result.routes) {
            let executionOrder = 0
            for (const step of route.steps) {
                if (step.type === 'start' || step.type === 'end' || step.type === 'break') continue

                const stopId = mapping.stops[step.id!]
                if (stopId) {
                    const stop = await Stop.find(stopId)
                    if (stop) {
                        stop.executionOrder = executionOrder++
                        await stop.save()
                    }
                }
            }
        }
    }
}
