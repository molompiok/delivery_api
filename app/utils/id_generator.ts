import { customAlphabet } from 'nanoid'

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
const nanoid = customAlphabet(alphabet, 18)

export function generateId(prefix: string) {
    return `${prefix}_${nanoid()}`
}
