export interface VroomLocation {
    id?: number
    index?: number
    location: [number, number] // [lon, lat]
}

export interface VroomJob {
    id: number
    description?: string
    location: [number, number]
    service?: number
    amount?: number[]
    skills?: number[]
    priority?: number
    time_windows?: [number, number][]
}

export interface VroomShipmentStep {
    id?: number
    description?: string
    location: [number, number]
    service?: number
    amount?: number[]
    skills?: number[]
    time_windows?: [number, number][]
}

export interface VroomShipment {
    amount?: number[]
    skills?: number[]
    priority?: number
    pickup: VroomShipmentStep
    delivery: VroomShipmentStep
    description?: string
}

export interface VroomVehicle {
    id: number
    profile?: string
    description?: string
    start?: [number, number]
    end?: [number, number]
    capacity?: number[]
    skills?: number[]
    time_window?: [number, number]
    breaks?: Array<{
        id: number
        time_windows: [number, number][]
        service: number
    }>
}

export interface VroomInput {
    vehicles: VroomVehicle[]
    jobs?: VroomJob[]
    shipments?: VroomShipment[]
    options?: {
        g?: boolean // use geometry
    }
}

export interface VroomStep {
    type: 'start' | 'job' | 'pickup' | 'delivery' | 'break' | 'end'
    location?: [number, number]
    id?: number
    service?: number
    waiting_time?: number
    job?: number
    shipment?: number
    arrival: number
    duration: number
    distance: number
    description?: string
}

export interface VroomRoute {
    vehicle: number
    steps: VroomStep[]
    cost: number
    duration: number
    distance: number
    priority?: number
    geometry?: string
}

export interface VroomResult {
    code: number
    error?: string
    summary: {
        cost: number
        unassigned: number
        delivery?: number[]
        amount?: number[]
        pickup?: number[]
        service: number
        duration: number
        waiting_time: number
        distance: number
    }
    routes: VroomRoute[]
    unassigned?: Array<{
        id: number
        type: string
        location: [number, number]
    }>
}
