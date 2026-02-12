import vine from '@vinejs/vine'

/**
 * Shared confirmation rule item schema
 */
export const confirmationRuleItemSchema = vine.object({
    name: vine.string().trim().minLength(1).maxLength(100),
    pickup: vine.boolean().optional(),
    delivery: vine.boolean().optional(),
    compare: vine.boolean().optional(),
    reference: vine.string().trim().nullable().optional(),
})

/**
 * Order Schemas
 */
export const createOrderSchema = vine.object({
    steps: vine.array(vine.object({
        sequence: vine.number().optional(),
        linked: vine.boolean().optional(),
        stops: vine.array(vine.any()), // Detailed expansion happens in StopService
    })).optional(),
    transit_items: vine.array(vine.object({
        id: vine.string().trim().optional(),
        name: vine.string().trim().minLength(1).optional(),
        weight: vine.number().optional(),
        dimensions: vine.any().optional(),
        metadata: vine.any().optional(),
    })).optional(),
    assignment_mode: vine.enum(['GLOBAL', 'INTERNAL', 'TARGET', 'global', 'internal', 'target'] as const).transform((v) => v.toUpperCase() as 'GLOBAL' | 'INTERNAL' | 'TARGET').optional(),
    ref_id: vine.string().trim().optional(),
    priority: vine.enum(['LOW', 'MEDIUM', 'HIGH', 'low', 'medium', 'high'] as const).transform((v) => v.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH').optional(),
    metadata: vine.any().optional(),
})

/**
 * Step Schemas
 */
export const addStepSchema = vine.object({
    sequence: vine.number().optional(),
    linked: vine.boolean().optional(),
    metadata: vine.any().optional(),
})

export const updateStepSchema = vine.object({
    sequence: vine.number().optional(),
    linked: vine.boolean().optional(),
    metadata: vine.any().optional(),
})

/**
 * Action Schemas
 */
export const addActionSchema = vine.object({
    type: vine.enum(['pickup', 'delivery', 'service', 'PICKUP', 'DELIVERY', 'SERVICE'] as const).transform((v) => v.toLowerCase() as 'pickup' | 'delivery' | 'service'),
    quantity: vine.number().min(0).optional(),
    transit_item_id: vine.string().trim().optional(),
    transit_item: vine.object({
        id: vine.string().trim().optional(),
        name: vine.string().trim().minLength(1).maxLength(100).optional(),
        description: vine.string().trim().optional(),
        product_url: vine.string().trim().url().optional(),
        packaging_type: vine.enum(['box', 'fluid'] as const).optional(),
        weight: vine.number().optional(), // No conversion, stored as is
        unitary_price: vine.number().optional(),
        dimensions: vine.object({
            width_cm: vine.number().optional(),
            height_cm: vine.number().optional(),
            depth_cm: vine.number().optional(),
            volume_l: vine.number().optional(),
        }).optional(),
        requirements: vine.array(vine.enum(['froid', 'fragile', 'dangerous', 'sec'] as const)).optional(),
        metadata: vine.any().optional(),
    }).optional(),
    service_time: vine.number().min(0).optional(),
    confirmation_rules: vine.object({
        photo: vine.array(confirmationRuleItemSchema).optional(),
        code: vine.array(confirmationRuleItemSchema).optional(),
    }).optional(),
    metadata: vine.any().optional(),
})

export const updateActionSchema = vine.object({
    type: vine.enum(['pickup', 'delivery', 'service', 'PICKUP', 'DELIVERY', 'SERVICE'] as const).transform((v) => v.toLowerCase() as 'pickup' | 'delivery' | 'service').optional(),
    quantity: vine.number().min(0).optional(),
    transit_item_id: vine.string().trim().optional(),
    transit_item: vine.object({
        id: vine.string().trim().optional(),
        name: vine.string().trim().minLength(1).maxLength(100),
        description: vine.string().trim().optional(),
        product_url: vine.string().trim().url().optional(),
        packaging_type: vine.enum(['box', 'fluid'] as const).optional(),
        weight: vine.number().optional(), // No conversion, stored as is
        unitary_price: vine.number().optional(),
        dimensions: vine.object({
            width_cm: vine.number().optional(),
            height_cm: vine.number().optional(),
            depth_cm: vine.number().optional(),
            volume_l: vine.number().optional(),
        }).optional(),
        requirements: vine.array(vine.enum(['froid', 'fragile', 'dangerous', 'sec'] as const)).optional(),
        metadata: vine.any().optional(),
    }).optional(),
    service_time: vine.number().min(0).optional(),
    confirmation_rules: vine.object({
        photo: vine.array(confirmationRuleItemSchema).optional(),
        code: vine.array(confirmationRuleItemSchema).optional(),
    }).optional(),
    metadata: vine.any().optional(),
})

/**
 * Stop Schemas
 */
export const addStopSchema = vine.object({
    address: vine.object({
        address_id: vine.string().trim().optional(),
        street: vine.string().trim().maxLength(255).optional(),
        city: vine.string().trim().optional(),
        country: vine.string().trim().optional(),
        lat: vine.number().optional(),
        lng: vine.number().optional(),
        call: vine.string().trim().optional(),
        room: vine.string().trim().optional(),
        stage: vine.string().trim().optional(),
    }).optional(),
    client: vine.object({
        client_id: vine.string().trim().optional(),
        name: vine.string().trim().minLength(1).maxLength(100).optional(),
        phone: vine.string().trim().optional(),
        email: vine.string().trim().optional(),
        avatar: vine.string().trim().optional(),
        opening_hours: vine.object({
            start: vine.string().trim().optional(),
            end: vine.string().trim().optional(),
            duration: vine.number().optional(),
        }).optional(),
    }).optional(),
    display_order: vine.number().optional(),
    coordinates: vine.array(vine.number()).optional(),
    actions: vine.array(addActionSchema).optional(),
    metadata: vine.any().optional(),
    reverse_geocode: vine.boolean().optional(),
    add_default_service: vine.boolean().optional(),
})

export const updateStopSchema = vine.object({
    address: vine.object({
        address_id: vine.string().trim().optional(),
        street: vine.string().trim().maxLength(255).optional(),
        city: vine.string().trim().optional(),
        country: vine.string().trim().optional(),
        lat: vine.number().optional(),
        lng: vine.number().optional(),
        call: vine.string().trim().optional(),
        room: vine.string().trim().optional(),
        stage: vine.string().trim().optional(),
    }).optional(),
    client: vine.object({
        client_id: vine.string().trim().optional(),
        name: vine.string().trim().minLength(1).maxLength(100).optional(),
        phone: vine.string().trim().optional(),
        email: vine.string().trim().optional(),
        avatar: vine.string().trim().optional(),
        opening_hours: vine.object({
            start: vine.string().trim().optional(),
            end: vine.string().trim().optional(),
            duration: vine.number().optional(),
        }).optional(),
    }).optional(),
    display_order: vine.number().optional(),
    coordinates: vine.array(vine.number()).optional(),
    actions: vine.array(addActionSchema).optional(),
    metadata: vine.any().optional(),
})

/**
 * Transit Item Schema
 */
export const transitItemSchema = vine.object({
    id: vine.string().trim().optional(),
    product_id: vine.string().trim().optional(),
    name: vine.string().trim().minLength(1).maxLength(100).optional(),
    description: vine.string().trim().optional(),
    product_url: vine.string().trim().url().optional(),
    packaging_type: vine.enum(['box', 'fluid', 'BOX', 'FLUID'] as const).transform((v) => v.toLowerCase() as 'box' | 'fluid').optional(),
    weight: vine.number().optional(), // No conversion
    unitary_price: vine.number().optional(),
    dimensions: vine.object({
        width_cm: vine.number().optional(),
        height_cm: vine.number().optional(),
        depth_cm: vine.number().optional(),
        volume_l: vine.number().optional(),
    }).optional(),
    requirements: vine.array(vine.enum(['froid', 'fragile', 'dangerous', 'sec', 'FROID', 'FRAGILE', 'DANGEROUS', 'SEC'] as const).transform((v) => v.toLowerCase() as any)).optional(),
    metadata: vine.any().optional(),
})
