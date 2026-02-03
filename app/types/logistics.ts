export interface PricingDetails {
    clientFee: number
    driverRemuneration: number
    currency?: string
    breakdown?: {
        baseFee?: number
        distanceFee?: number
        durationFee?: number
        surcharges?: {
            weight?: number
            volume?: number
            fragile?: number
        }
    }
}

export enum WaypointStatus {
    PENDING = 'PENDING',
    ARRIVED = 'ARRIVED',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

export interface WaypointSummaryItem {
    type: 'pickup' | 'delivery'
    address_id: string
    address_text?: string
    coordinates: [number, number]
    sequence: number
    status: WaypointStatus
    confirmation_code?: string
    is_mandatory: boolean
    notes?: string
    start_at?: string | null
    end_at?: string | null
    photo_urls?: string[]
    name?: string
}

export enum CalculationEngine {
    VALHALLA = 'valhalla',
    OSRM = 'osrm',
    GOOGLE = 'google',
    FALLBACK = 'fallback'
}

export interface LogisticsValidationError {
    message: string
    path: string
    field?: string
    severity: 'error' | 'warning'
}

export interface LogisticsValidationResult {
    success: boolean
    errors: LogisticsValidationError[]
    warnings: LogisticsValidationError[]
}

export interface LogisticsOperationResult<T> {
    entity: T
    validationErrors: LogisticsValidationError[]
    warnings?: LogisticsValidationError[]
}
