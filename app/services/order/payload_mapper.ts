import { generateId } from '../../utils/id_generator.js'

export interface MappingResult {
    map: Map<string, string>
    items: any[]
}

export default class PayloadMapper {
    /**
     * Generates a mapping from client-side temporary IDs to system UUIDs.
     * Returns the modified items payload with system UUIDs.
     */
    static mapTransitItems(items: any[] = []): MappingResult {
        const map = new Map<string, string>()
        const processedItems = items.map(item => {
            // Check if ID is already a valid system UUID (e.g. valid nanoid length ~21 with prefix)
            // or if it's a temp ID. For now, we assume if it's passed in bulk creation
            // and we are mapping, we re-generate to avoid collisions unless explicitly handling updates.
            // But if we want to allow "upsert" later, we might need to check DB.
            // For CREATE flow, we always generate new IDs for "temp" looking IDs.

            // Simple heuristic: if it looks like a user-provided string (not starting with 'tri_'), map it.
            // Or simpler: Always map if it's in the input, assuming it's a reference.

            const originalId = item.id
            const newId = generateId('tri')

            if (originalId) {
                map.set(originalId, newId)
            }

            return {
                ...item,
                id: newId
            }
        })

        return { map, items: processedItems }
    }

    /**
     * Traverses the steps/stops/actions tree and replaces transit_item_ids 
     * using the provided map.
     */
    static replaceReferenceIds(steps: any[] = [], itemMap: Map<string, string>): any[] {
        return steps.map(step => ({
            ...step,
            stops: (step.stops || []).map((stop: any) => ({
                ...stop,
                actions: (stop.actions || []).map((action: any) => {
                    const originalId = action.transit_item_id
                    if (originalId && itemMap.has(originalId)) {
                        return {
                            ...action,
                            transit_item_id: itemMap.get(originalId)
                        }
                    }
                    return action
                })
            }))
        }))
    }
}
