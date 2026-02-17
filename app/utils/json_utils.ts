import { BaseModel } from '@adonisjs/lucid/orm'

/**
 * Updates a specific field within a JSON column of a Lucid model.
 * 
 * @param model The Lucid model instance (e.g. Order, Stop)
 * @param column The name of the JSON column (e.g. 'metadata')
 * @param value The value to merge or set
 * @param key The specific key within the JSON object to update. 
 *            If empty string '' or null, the entire column value is replaced by `value`.
 * 
 * @example
 * // Update specific key
 * await updateMetadataField(order, 'metadata', { lat: 10, lng: 5 }, 'driver_position')
 * 
 * @example
 * // Overwrite entire metadata
 * await updateMetadataField(order, 'metadata', { new: 'full_object' }, '')
 */
export async function updateMetadataField<T extends BaseModel>(
    model: T,
    column: keyof T,
    value: any,
    key?: string
): Promise<void> {
    // 1. Get current value (ensure it's an object)
    let currentJson = (model[column] as any) || {}

    // Handle case where current value is not an object (e.g. null/undefined due to DB state)
    if (typeof currentJson !== 'object' || currentJson === null) {
        currentJson = {}
    }

    // 2. Clone to avoid mutation side-effects before reassignment
    const newJson = { ...currentJson }

    // 3. Update logic
    // Use bracket notation with type assertion to assign to the model property
    if (!key || key === '') {
        // Overwrite mode
        // If value is an object, we merge it into a fresh object to be safe, 
        // or just replace if that's the strict intent. 
        // User request: "si le 'champs dans le JSON' est '' => alos on ecrase le JSON."
        // So we assume value IS the new metadata object.
        (model as any)[column] = value
    } else {
        // Merge/Set specific key mode
        newJson[key] = value;
        (model as any)[column] = newJson
    }
}
