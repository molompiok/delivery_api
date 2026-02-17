import env from '../../../start/env.js'
import logger from '@adonisjs/core/services/logger'
import GeoService from '#services/geo_service'

export interface OrToolsAction {
    type: 'pickup' | 'delivery' | 'service'
    item_id?: string
    quantity: number
    weight: number
    volume: number
    service_time: number
}

export interface OrToolsStop {
    id: string
    index: number
    actions: OrToolsAction[]
    is_frozen?: boolean
    time_window_start?: number
    time_window_end?: number
}

export interface OrToolsVehicle {
    max_weight: number
    max_volume: number
    start_index: number
}

export interface OrToolsOptimizationResult {
    status: 'success' | 'no_solution' | 'error'
    stopOrder: Array<{ stop_id: string, execution_order: number }>
    totalDistance: number
    totalTime: number
    droppedStops: string[]
    message?: string
}

export class OptimizationError extends Error {
    constructor(public message: string, public details?: any) {
        super(message)
        this.name = 'OptimizationError'
    }
}

export default class OrToolsService {
    private orToolsUrl = env.get('OR_TOOLS_URL', 'http://localhost:5055')

    /**
     * Solves the vehicle routing problem with pickup and delivery constraints.
     */
    async optimize(
        stops: OrToolsStop[],
        vehicle: OrToolsVehicle,
        coordinates: Array<{ lat: number, lon: number }>
    ): Promise<OrToolsOptimizationResult | null> {
        // logger.info({
        //     stopCount: stops.length,
        //     coordCount: coordinates.length,
        //     vehicle: { max_weight: vehicle.max_weight, max_volume: vehicle.max_volume }
        // }, '[OR_TOOLS] Starting optimization request')

        try {
            // 0. Preliminary validations to prevent Segfaults in microservice
            if (stops.length === 0) {
                logger.warn('[OR_TOOLS] Optimization aborted: No stops provided')
                return { status: 'success', stopOrder: [], totalDistance: 0, totalTime: 0, droppedStops: [] }
            }

            if (coordinates.length !== stops.length + 1) {
                logger.error({
                    coords: coordinates.length,
                    stops: stops.length
                }, '[OR_TOOLS] Coordinate mismatch: must be stops + 1 (start location)')
                throw new OptimizationError('Coordinate mismatch for OR-Tools')
            }

            // 1. Get Distance/Time Matrix from Valhalla
            // logger.debug('[OR_TOOLS] Fetching distance matrix from Valhalla...')
            const matrix = await GeoService.getDistanceMatrix(coordinates)
            if (!matrix) {
                logger.error({ coordinates }, 'Could not fetch distance matrix')
                throw new OptimizationError('Could not fetch distance matrix from Valhalla')
            }
            // logger.debug({
            //     matrixSize: matrix.distances.length,
            //     matrixRows: matrix.distances[0]?.length
            // }, '[OR_TOOLS] Matrix received')

            // 2. Prepare payload for OR-Tools microservice
            const payload = {
                stops,
                vehicle,
                distance_matrix: matrix.distances,
                time_matrix: matrix.times
            }

            // 3. Call OR-Tools Microservice
            // logger.info({ payload }, '[OR_TOOLS] Sending payload to microservice')
            logger.info({ url: `${this.orToolsUrl}/optimize` }, '[OR_TOOLS] Calling microservice...')
            const startTime = Date.now()

            const response = await fetch(`${this.orToolsUrl}/optimize`, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
                // Add a timeout to prevent hanging the whole server if the service is stuck
                signal: AbortSignal.timeout(30000) // 30s timeout
            })

            const duration = Date.now() - startTime

            if (!response.ok) {
                const errorData = await response.text()
                logger.error({
                    status: response.status,
                    duration,
                    data: errorData
                }, '[OR_TOOLS] Microservice returned error')
                throw new OptimizationError(`OR-Tools API error: ${response.status}`, errorData)
            }

            const data = await response.json() as any

            if (data.status === 'error' || data.status === 'no_solution') {
                logger.error({ data, duration }, '[OR_TOOLS] Optimization failed or no solution')
                // We return a failure result but don't necessarily throw if we want to fallback gracefully
                return {
                    status: data.status,
                    stopOrder: [],
                    totalDistance: 0,
                    totalTime: 0,
                    droppedStops: data.dropped_stops || [],
                    message: data.message
                }
            }

            // logger.info({
            //     status: data.status,
            //     duration,
            //     stopOrderCount: data.stop_order?.length,
            //     droppedCount: data.dropped_stops?.length
            // }, '[OR_TOOLS] Optimization successful')

            return {
                status: data.status,
                stopOrder: data.stop_order,
                totalDistance: data.total_distance,
                totalTime: data.total_time,
                droppedStops: data.dropped_stops,
                message: data.message
            }

        } catch (error: any) {
            if (error.name === 'TimeoutError') {
                logger.error('[OR_TOOLS] Request timed out after 30s')
                throw new OptimizationError('OR-Tools request timed out')
            }
            if (error instanceof OptimizationError) throw error
            logger.error({ err: error }, 'Error calling OR-Tools service')
            throw new OptimizationError('Error calling OR-Tools service', error)
        }
    }
}

