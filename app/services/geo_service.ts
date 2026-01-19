import env from '../../start/env.js'
import logger from '@adonisjs/core/services/logger'
import polyline from '@mapbox/polyline'

import { WaypointStatus, WaypointSummaryItem, CalculationEngine } from '../types/logistics.js'


export interface LegManeuver {
    type: number
    instruction: string
    verbal_transition_instruction?: string
    verbal_pre_transition_instruction?: string
    verbal_post_transition_instruction?: string
    street_names?: string[]
    time: number
    length: number
    cost: number
    begin_shape_index: number
    end_shape_index: number
    verbal_multi_cue?: boolean
    travel_mode: string
    travel_type: string
}

export interface OptimizedRouteDetails {
    global_summary: {
        total_duration_seconds: number
        total_distance_meters: number
    }
    legs: Array<{
        geometry: { type: 'LineString'; coordinates: number[][] }
        duration_seconds: number
        distance_meters: number
        maneuvers: LegManeuver[]
        raw_valhalla_leg_data?: any
    }>
    calculation_engine: CalculationEngine
    waypoints_summary_for_order?: WaypointSummaryItem[]
}

interface ValhallaLocation {
    lat: number
    lon: number
    type: 'break' | 'through'
    heading?: number
}

interface ValhallaLeg {
    summary: {
        time: number
        length: number
    }
    maneuvers: LegManeuver[]
    shape: string
}

interface ValhallaTrip {
    locations: ValhallaLocation[]
    legs: ValhallaLeg[]
    summary: {
        time: number
        length: number
    }
    status: number
    status_message: string
    units: string
}

class GeoService {
    private valhallaUrl = env.get('VALHALLA_URL') || 'http://localhost:8002'

    /**
     * Geocodes an address string to [lon, lat] coordinates via Nominatim (OSM).
     */
    async geocode(address: string): Promise<[number, number] | null> {
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'SublymusDelivery/1.0', // Required by OSM terms
                    'Accept-Language': 'fr-CI,fr;q=0.9',
                },
            })

            if (!response.ok) return null

            const data = await response.json() as any[]
            if (data && data.length > 0) {
                const result = data[0]
                return [parseFloat(result.lon), parseFloat(result.lat)]
            }

            return null
        } catch (error) {
            logger.error({ err: error, address }, 'Geocoding failed')
            return null
        }
    }

    /**
     * Calculates time and distance from point A to B.
     */
    async getDirectRouteInfo(
        startCoordinates: [number, number], // lon, lat
        endCoordinates: [number, number],   // lon, lat
        costingModel: string = 'auto'
    ): Promise<{ durationSeconds: number; distanceMeters: number; geometry?: any } | null> {
        const requestBody = {
            locations: [
                { lon: startCoordinates[0], lat: startCoordinates[1], type: 'break' as const },
                { lon: endCoordinates[0], lat: endCoordinates[1], type: 'break' as const },
            ],
            costing: costingModel,
            language: 'fr-FR',
            directions_options: { units: 'kilometers' },
        }

        try {
            const response = await fetch(`${this.valhallaUrl}/route`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            })

            if (!response.ok) {
                const errorData = await response.text()
                logger.error({ status: response.status, data: errorData }, 'Valhalla API error')
                return null
            }

            const data = await response.json() as { trip: ValhallaTrip }
            if (data?.trip?.summary && data.trip.legs?.length > 0) {
                const tripSummary = data.trip.summary
                const firstLeg = data.trip.legs[0]

                const decodedShape = polyline.decode(firstLeg.shape, 6) as [number, number][]
                const geoJsonCoords = decodedShape.map(p => [p[1], p[0]])

                return {
                    durationSeconds: Math.round(tripSummary.time),
                    distanceMeters: Math.round(tripSummary.length * 1000),
                    geometry: { type: 'LineString' as const, coordinates: geoJsonCoords },
                }
            }
            return null
        } catch (error) {
            logger.error({ err: error }, 'Error calling Valhalla for direct route')
            return null
        }
    }

    /**
     * Calculates an optimized route for multiple stop mission.
     */
    async calculateOptimizedRoute(
        waypoints: Array<{
            coordinates: [number, number]
            type: 'break' | 'through'
            address_id?: string
            address_text?: string
            waypoint_type_for_summary?: 'pickup' | 'delivery'
            package_name_for_summary?: string
        }>
    ): Promise<OptimizedRouteDetails | null> {
        if (waypoints.length < 2) return null

        const valhallaLocations: ValhallaLocation[] = waypoints.map(wp => ({
            lon: wp.coordinates[0],
            lat: wp.coordinates[1],
            type: wp.type,
        }))

        const requestBody = {
            locations: valhallaLocations,
            costing: 'auto',
            costing_options: {
                auto: { top_speed: 30 },
            },
            language: 'fr-FR',
            directions_options: { units: 'kilometers' },
        }

        try {
            const response = await fetch(`${this.valhallaUrl}/route`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            })

            if (!response.ok) {
                const errorData = await response.text()
                logger.error({ status: response.status, data: errorData }, 'Valhalla Optimized Route API error')
                return null
            }

            const data = await response.json() as { trip: ValhallaTrip }
            const trip = data.trip

            if (!trip || !trip.legs || trip.legs.length === 0) return null

            const parsedLegs = trip.legs.map((leg: ValhallaLeg) => {
                const decodedShape = polyline.decode(leg.shape, 6) as [number, number][]
                const geoJsonCoords = decodedShape.map(p => [p[1], p[0]])
                return {
                    geometry: { type: 'LineString' as const, coordinates: geoJsonCoords },
                    duration_seconds: Math.round(leg.summary.time),
                    distance_meters: Math.round(leg.summary.length * 1000),
                    maneuvers: leg.maneuvers,
                    raw_valhalla_leg_data: leg,
                }
            })

            const waypointsSummaryForOrder: WaypointSummaryItem[] = []

            // Helper to generate a 6-digit code
            const generateSecureCode = () => {
                return Math.floor(100000 + Math.random() * 900000).toString()
            }

            for (let i = 0; i < trip.legs.length; i++) {
                const destWp = waypoints[i + 1]
                if (destWp && destWp.waypoint_type_for_summary) {
                    waypointsSummaryForOrder.push({
                        type: destWp.waypoint_type_for_summary,
                        address_id: destWp.address_id || `wp_${i + 1}`,
                        address_text: destWp.address_text,
                        coordinates: destWp.coordinates,
                        sequence: i,
                        status: WaypointStatus.PENDING,
                        confirmation_code: generateSecureCode(),
                        is_mandatory: true,
                        photo_urls: [],
                        name: destWp.package_name_for_summary,
                    })
                }
            }

            return {
                global_summary: {
                    total_duration_seconds: Math.round(trip.summary.time),
                    total_distance_meters: Math.round(trip.summary.length * 1000),
                },
                legs: parsedLegs,
                calculation_engine: CalculationEngine.VALHALLA,
                waypoints_summary_for_order: waypointsSummaryForOrder,
            }
        } catch (error) {
            logger.warn({ err: error }, 'Error calling Valhalla for optimized route, falling back to direct calculation')

            // Fallback: Calculate direct distance and mock a route
            // This is "As the crow flies" calculation roughly adjusted for road factor (~1.3)
            let totalDistance = 0
            const legs: any[] = []

            for (let i = 0; i < waypoints.length - 1; i++) {
                const start = waypoints[i].coordinates
                const end = waypoints[i + 1].coordinates

                // Simple Haversine approx (sufficient for fallback)
                const R = 6371e3 // metres
                const φ1 = start[1] * Math.PI / 180
                const φ2 = end[1] * Math.PI / 180
                const Δφ = (end[1] - start[1]) * Math.PI / 180
                const Δλ = (end[0] - start[0]) * Math.PI / 180
                const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                    Math.cos(φ1) * Math.cos(φ2) *
                    Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
                const d = R * c

                const legDist = Math.round(d * 1.3) // 30% detour factor
                const legDur = Math.round(legDist / 8.33) // ~30 km/h avg speed in city

                totalDistance += legDist

                legs.push({
                    geometry: {
                        type: 'LineString',
                        coordinates: [[start[0], start[1]], [end[0], end[1]]]
                    },
                    duration_seconds: legDur,
                    distance_meters: legDist,
                    maneuvers: [],
                    raw_valhalla_leg_data: {}
                })
            }

            const waypointsSummaryForOrder: WaypointSummaryItem[] = []
            for (let i = 0; i < waypoints.length - 1; i++) {
                const destWp = waypoints[i + 1]
                if (destWp && destWp.waypoint_type_for_summary) {
                    waypointsSummaryForOrder.push({
                        type: destWp.waypoint_type_for_summary,
                        address_id: destWp.address_id || `wp_${i + 1}`,
                        address_text: destWp.address_text,
                        coordinates: destWp.coordinates,
                        sequence: i,
                        status: WaypointStatus.PENDING,
                        confirmation_code: Math.floor(100000 + Math.random() * 900000).toString(),
                        is_mandatory: true,
                        photo_urls: [],
                        name: destWp.package_name_for_summary,
                    })
                }
            }

            return {
                global_summary: {
                    total_duration_seconds: Math.round(totalDistance / 8.33),
                    total_distance_meters: totalDistance,
                },
                legs: legs,
                calculation_engine: CalculationEngine.GOOGLE, // Fallback engine, maybe name it 'FALLBACK' or 'DIRECT'
                waypoints_summary_for_order: waypointsSummaryForOrder,
            }
        }
    }
}

export default new GeoService()
