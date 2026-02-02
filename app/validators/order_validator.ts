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
 * Action Schemas
 */
export const addActionSchema = vine.object({
    type: vine.enum(['pickup', 'delivery', 'service'] as const),
    quantity: vine.number().min(0).optional(),
    transit_item_id: vine.string().trim().optional(),
    service_time: vine.number().min(0).optional(),
    confirmation_rules: vine.object({
        photo: vine.array(confirmationRuleItemSchema).optional(),
        code: vine.array(confirmationRuleItemSchema).optional(),
    }).optional(),
    metadata: vine.any().optional(),
})

export const updateActionSchema = vine.object({
    type: vine.enum(['pickup', 'delivery', 'service'] as const).optional(),
    quantity: vine.number().min(0).optional(),
    transit_item_id: vine.string().trim().optional(),
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
    address_text: vine.string().trim().minLength(5).maxLength(255),
    coordinates: vine.array(vine.number()).minLength(2).maxLength(2).optional(),
    sequence: vine.number().optional(),
    metadata: vine.any().optional(),
})

export const updateStopSchema = vine.object({
    address_text: vine.string().trim().minLength(5).maxLength(255).optional(),
    coordinates: vine.array(vine.number()).minLength(2).maxLength(2).optional(),
    sequence: vine.number().optional(),
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
 * Transit Item Schemas
 */
export const transitItemSchema = vine.object({
    id: vine.string().trim().optional(), // For bulk mapping
    product_id: vine.string().trim().optional(),
    name: vine.string().trim().minLength(1).maxLength(100),
    description: vine.string().trim().optional(),
    packaging_type: vine.enum(['box', 'fluid'] as const).optional(),
    weight_g: vine.number().optional(),
    volume_l: vine.number().optional(),
    dimensions: vine.object({
        width_cm: vine.number().optional(),
        height_cm: vine.number().optional(),
        length_cm: vine.number().optional(),
    }).optional(),
    unitary_price: vine.number().optional(),
    requirements: vine.array(vine.enum(['froid', 'fragile', 'dangerous', 'sec'] as const)).optional(),
    type_product: vine.array(vine.enum(['liquide', 'poudre', 'papier', 'food', 'electronic', 'other'] as const)).optional(),
    metadata: vine.any().optional(),
})

/**
 * Bulk Order Schema
 */
export const createOrderSchema = vine.object({
    steps: vine.array(
        vine.object({
            sequence: vine.number().optional(),
            linked: vine.boolean().optional(),
            stops: vine.array(
                vine.object({
                    address_text: vine.string().trim().minLength(5).maxLength(255),
                    coordinates: vine.array(vine.number()).minLength(2).maxLength(2).optional(),
                    sequence: vine.number().optional(),
                    actions: vine.array(addActionSchema).minLength(1)
                })
            ).minLength(1)
        })
    ).minLength(1),
    transit_items: vine.array(transitItemSchema).optional(),
    ref_id: vine.string().trim().optional(),
    assignment_mode: vine.enum(['GLOBAL', 'INTERNAL', 'TARGET']).optional(),
    priority: vine.enum(['LOW', 'MEDIUM', 'HIGH'] as const).optional(),
    optimize_route: vine.boolean().optional(),
    allow_overload: vine.boolean().optional(),
    metadata: vine.any().optional(),
})
