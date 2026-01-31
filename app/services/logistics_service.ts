import Action from '#models/action'

export default class LogisticsService {
    /**
     * Validates an order state (virtual or real) for structural and logical integrity.
     * @param orderState The desired state of the order (steps -> stops -> actions)
     * @returns { success: boolean, errors: string[] }
     */
    static validateOrderConsistency(orderState: any): { success: boolean, errors: string[] } {
        const errors: string[] = []

        if (!orderState.steps || orderState.steps.length === 0) {
            errors.push('Order must have at least one step')
            return { success: false, errors }
        }

        const transitItems = orderState.transit_items || []
        const itemBalances = new Map<string, number>()

        // 1. Structural & Item Existence Check
        orderState.steps.forEach((step: any, stepIdx: number) => {
            if (!step.stops || step.stops.length === 0) {
                errors.push(`Step ${stepIdx} must have at least one stop`)
            } else {
                step.stops.forEach((stop: any, stopIdx: number) => {
                    if (!stop.actions || stop.actions.length === 0) {
                        errors.push(`Step ${stepIdx}, Stop ${stopIdx} must have at least one action`)
                    } else {
                        stop.actions.forEach((action: any, actionIdx: number) => {
                            if (action.transit_item_id) {
                                const item = transitItems.find((ti: any) => ti.id === action.transit_item_id)
                                if (!item) {
                                    errors.push(`Action ${actionIdx} at Step ${stepIdx}, Stop ${stopIdx} refers to unknown transit item: ${action.transit_item_id}`)
                                }
                            }
                        })
                    }
                })
            }
        })

        if (errors.length > 0) return { success: false, errors }

        // 2. Quantity & Sequence Check (Order of stops matters)
        // Flatten all stops in sequence across steps
        const allStops = orderState.steps.flatMap((step: any) => step.stops)

        allStops.forEach((stop: any, stopIdx: number) => {
            stop.actions.forEach((action: any) => {
                const itemId = action.transit_item_id
                if (!itemId) return

                const qty = action.quantity || 1
                const currentBalance = itemBalances.get(itemId) || 0

                const type = action.type?.toUpperCase()
                if (type === 'PICKUP') {
                    itemBalances.set(itemId, currentBalance + qty)
                } else if (type === 'DELIVERY') {
                    if (currentBalance < qty) {
                        errors.push(`Cannot deliver item ${itemId} at Stop ${stopIdx}: Insufficient quantity on board (${currentBalance} < ${qty})`)
                    }
                    itemBalances.set(itemId, currentBalance - qty)
                }
            })
        })

        // 3. Final Balance Check
        itemBalances.forEach((balance, itemId) => {
            if (balance !== 0) {
                errors.push(`Quantity mismatch for item ${itemId}: Final balance is ${balance} (should be 0)`)
            }
        })

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
