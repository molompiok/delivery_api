import Action from '#models/action'

export interface LogisticsValidationError {
    message: string
    path: string
    field?: string
}

export interface LogisticsValidationResult {
    success: boolean
    errors: LogisticsValidationError[]
}

export default class LogisticsService {
    /**
     * Validates an order state (virtual or real) for structural and logical integrity.
     */
    static validateDraftConsistency(orderState: any): LogisticsValidationResult {
        return this.validateOrderConsistency(orderState, 'EDIT')
    }

    static validateOrderConsistency(orderState: any, context: 'EDIT' | 'SUBMIT' = 'SUBMIT'): LogisticsValidationResult {
        const errors: LogisticsValidationError[] = []

        if (!orderState.steps || orderState.steps.length === 0) {
            errors.push({ message: 'Order must have at least one step', path: 'steps' })
        }

        const transitItems = orderState.transit_items || []

        // 1. Structural & Item Existence Check
        if (orderState.steps) {
            orderState.steps.forEach((step: any, stepIdx: number) => {
                const stepPath = `steps[${stepIdx}]`
                if (!step.stops || step.stops.length === 0) {
                    errors.push({ message: `Step must have at least one stop`, path: stepPath, field: 'stops' })
                } else {
                    step.stops.forEach((stop: any, stopIdx: number) => {
                        const stopPath = `${stepPath}.stops[${stopIdx}]`
                        if (!stop.actions || stop.actions.length === 0) {
                            errors.push({ message: `Stop must have at least one action`, path: stopPath, field: 'actions' })
                        } else {
                            stop.actions.forEach((action: any, actionIdx: number) => {
                                const actionPath = `${stopPath}.actions[${actionIdx}]`
                                const actType = (action.type || 'service').toLowerCase()

                                // Enforce quantity/type logic
                                if (actType === 'service') {
                                    if (action.quantity !== undefined && action.quantity !== 0) {
                                        errors.push({ message: 'Quantity must be 0 for service actions', path: actionPath, field: 'quantity' })
                                    }
                                } else {
                                    if (action.quantity === undefined || action.quantity <= 0) {
                                        errors.push({ message: 'Quantity must be greater than 0 for pickup or delivery', path: actionPath, field: 'quantity' })
                                    }
                                }

                                if (actType !== 'service' && action.transit_item_id) {
                                    const item = transitItems.find((ti: any) => ti.id === action.transit_item_id)
                                    if (!item) {
                                        errors.push({
                                            message: `Action refers to unknown transit item: ${action.transit_item_id}`,
                                            path: actionPath,
                                            field: 'transit_item_id'
                                        })
                                    }
                                }
                            })
                        }
                    })
                }
            })
        }

        // 2. Step-by-Step Viability Check
        let runningItemBalances = new Map<string, number>()

        if (orderState.steps) {
            orderState.steps.forEach((step: any, stepIdx: number) => {
                const stepPath = `steps[${stepIdx}]`
                const stepPickups = new Map<string, number>()
                const stepDeliveries = new Map<string, number>()

                step.stops.forEach((stop: any) => {
                    stop.actions.forEach((action: any) => {
                        const itemId = action.transit_item_id
                        if (!itemId) return
                        const qty = action.quantity || 1
                        const type = action.type?.toUpperCase()

                        if (type === 'PICKUP') {
                            stepPickups.set(itemId, (stepPickups.get(itemId) || 0) + qty)
                        } else if (type === 'DELIVERY') {
                            stepDeliveries.set(itemId, (stepDeliveries.get(itemId) || 0) + qty)
                        }
                    })
                })

                // Rule: For each item, (Balance before Step + Total Pickups in Step) >= Total Deliveries in Step
                stepDeliveries.forEach((totalDelivery, itemId) => {
                    const balanceBefore = runningItemBalances.get(itemId) || 0
                    const totalPickupInStep = stepPickups.get(itemId) || 0
                    if (balanceBefore + totalPickupInStep < totalDelivery) {
                        errors.push({
                            message: `Step is non-viable for item ${itemId}: Available ${balanceBefore + totalPickupInStep} < Required ${totalDelivery}`,
                            path: stepPath
                        })
                    }
                })

                // Update running balance for next step
                stepPickups.forEach((qty, itemId) => {
                    runningItemBalances.set(itemId, (runningItemBalances.get(itemId) || 0) + qty)
                })
                stepDeliveries.forEach((qty, itemId) => {
                    runningItemBalances.set(itemId, (runningItemBalances.get(itemId) || 0) - qty)
                })
            })
        }

        // 3. Final Balance Check (Only for SUBMIT)
        if (context === 'SUBMIT') {
            runningItemBalances.forEach((balance, itemId) => {
                if (balance !== 0) {
                    errors.push({
                        message: `Quantity mismatch for item ${itemId}: Final balance is ${balance} (should be 0)`,
                        path: 'transit_items'
                    })
                }
            })
        }

        return {
            success: errors.length === 0,
            errors
        }
    }

    /**
     * Calculates the actual load of a vehicle at any given action step.
     */
    static calculateLoadProgression(actions: Action[]): number[] {
        let currentLoad = 0
        const progression: number[] = []

        for (const action of actions) {
            if (action.type === 'PICKUP') currentLoad += (action.quantity || 1)
            if (action.type === 'DELIVERY') currentLoad -= (action.quantity || 1)
            progression.push(currentLoad)
        }

        return progression
    }
}
