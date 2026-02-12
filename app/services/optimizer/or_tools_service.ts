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
        // ... (rest of method remains same)
        try {
            // 1. Get Distance/Time Matrix from Valhalla
            const matrix = await GeoService.getDistanceMatrix(coordinates)
            if (!matrix) {
                return { status: 'error', message: 'Could not fetch distance matrix from Valhalla', stopOrder: [], totalDistance: 0, totalTime: 0, droppedStops: [] }
            }

            // 2. Prepare payload for OR-Tools microservice
            const payload = {
                stops,
                vehicle,
                distance_matrix: matrix.distances,
                time_matrix: matrix.times
            }

            // 3. Call OR-Tools Microservice
            const response = await fetch(`${this.orToolsUrl}/optimize`, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!response.ok) {
                const errorData = await response.text()
                logger.error({ status: response.status, data: errorData }, 'OR-Tools API error')
                return { status: 'error', message: `OR-Tools API error: ${response.status}`, stopOrder: [], totalDistance: 0, totalTime: 0, droppedStops: [] }
            }

            const data = await response.json() as any

            return {
                status: data.status,
                stopOrder: data.stop_order,
                totalDistance: data.total_distance,
                totalTime: data.total_time,
                droppedStops: data.dropped_stops,
                message: data.message
            }

        } catch (error) {
            logger.error({ err: error }, 'Error calling OR-Tools service')
            return null
        }
    }
}

