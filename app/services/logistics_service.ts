import Action from '#models/action'
import { LogisticsValidationError, LogisticsValidationResult } from '../types/logistics.js'

export default class LogisticsService {
    /**
     * Validates an order state (virtual or real) for structural and logical integrity.
     */
    static validateDraftConsistency(orderState: any): LogisticsValidationResult {
        return this.validateOrderConsistency(orderState, 'EDIT')
    }

    static validateOrderConsistency(orderState: any, _context: 'EDIT' | 'SUBMIT' = 'SUBMIT'): LogisticsValidationResult {
        const errors: LogisticsValidationError[] = []
        const warnings: LogisticsValidationError[] = []

        if (!orderState.steps || orderState.steps.length === 0) {
            errors.push({ message: 'Order must have at least one step', path: 'steps', severity: 'error' })
        }

        const transitItems = orderState.transit_items || []

        // 1. Structural & Item Existence Check
        if (orderState.steps) {
            orderState.steps.forEach((step: any, stepIdx: number) => {
                const stepPath = `steps[${stepIdx}]`
                if (!step.stops || step.stops.length === 0) {
                    errors.push({ message: `Step must have at least one stop`, path: stepPath, field: 'stops', severity: 'error' })
                } else {
                    step.stops.forEach((stop: any, stopIdx: number) => {
                        const stopPath = `${stepPath}.stops[${stopIdx}]`
                        if (!stop.actions || stop.actions.length === 0) {
                            errors.push({ message: `Stop must have at least one action`, path: stopPath, field: 'actions', severity: 'error' })
                        } else {
                            stop.actions.forEach((action: any, actionIdx: number) => {
                                const actionPath = `${stopPath}.actions[${actionIdx}]`
                                const actType = (action.type || 'service').toLowerCase()

                                // Enforce quantity/type logic
                                if (actType === 'service') {
                                    if (action.quantity !== undefined && action.quantity !== 0) {
                                        errors.push({ message: 'Quantity must be 0 for service actions', path: actionPath, field: 'quantity', severity: 'error' })
                                    }
                                } else {
                                    if (action.quantity === undefined || action.quantity <= 0) {
                                        errors.push({ message: 'Quantity must be greater than 0 for pickup or delivery', path: actionPath, field: 'quantity', severity: 'error' })
                                    }
                                }

                                if (actType !== 'service' && action.transit_item_id) {
                                    const item = transitItems.find((ti: any) => ti.id === action.transit_item_id)
                                    if (!item) {
                                        errors.push({
                                            message: `Action refers to unknown transit item: ${action.transit_item_id}`,
                                            path: actionPath,
                                            field: 'transit_item_id',
                                            severity: 'error'
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
                            path: stepPath,
                            severity: 'error'
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

        // 3. Final Balance Check (Warning vs Error)
        runningItemBalances.forEach((balance, itemId) => {
            const item = transitItems.find((t: any) => t.id === itemId)
            const itemName = item ? ` (${item.name || 'Unknown'})` : ''

            if (balance < 0) {
                // Should have been caught by step check, but double safety
                errors.push({
                    message: `Impossible state for item ${itemId}${itemName}: Final balance is negative (${balance})`,
                    path: 'transit_items',
                    severity: 'error'
                })
            } else if (balance > 0) {
                // Warning: Items left in truck
                warnings.push({
                    message: `Incomplete mission for item ${itemId}${itemName}: ${balance} units remaining on board`,
                    path: 'transit_items',
                    severity: 'warning'
                })
            }
        })

        // 4. Orphaned Item Check
        // Check if any declared transit item is never referenced in any action
        // We can collect all referenced item IDs during the step iteration
        const referencedItemIds = new Set<string>()
        if (orderState.steps) {
            orderState.steps.forEach((step: any) => {
                if (step.stops) {
                    step.stops.forEach((stop: any) => {
                        if (stop.actions) {
                            stop.actions.forEach((action: any) => {
                                if (action.transit_item_id) {
                                    referencedItemIds.add(action.transit_item_id)
                                }
                            })
                        }
                    })
                }
            })
        }

        transitItems.forEach((item: any, index: number) => {
            if (!referencedItemIds.has(item.id)) {
                warnings.push({
                    message: `Unused transit item: ${item.id} (${item.name || 'Unknown'})`,
                    path: `transit_items[${index}]`,
                    severity: 'warning'
                })
            }
        })

        // If context is SUBMIT, we might want to block warnings depending on strictness
        // For now, consistent with user req: Warning doesn't block "creation" but might block "submit" logic in controller if we choose so.
        // The user said "Warning ... blocks Submit or Push".
        // So validation success depends on errors only? Or should we include warnings in failure for SUBMIT?
        // User said: "Warning ... blocks submit". So if context is SUBMIT and warnings > 0, is it valid?
        // Usually `valid = errors.length === 0`.
        // The controller/service calling this will decide if it proceeds with warnings.
        // We just return both.

        return {
            success: errors.length === 0,
            errors,
            warnings
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
