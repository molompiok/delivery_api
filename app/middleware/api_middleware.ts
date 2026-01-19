import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import ApiKey from '#models/api_key'
import hash from '@adonisjs/core/services/hash'

export default class ApiMiddleware {
    public async handle({ request, response }: HttpContext, next: NextFn) {
        const authorization = request.header('authorization')
        // const managerId = request.header('x-manager-id') // We still might need this for context

        if (!authorization) {
            return response.unauthorized({ message: 'Authorization header is required' })
        }

        const [type, token] = authorization.split(' ')
        if (!token || type?.toLowerCase() !== 'bearer') {
            return response.unauthorized({ message: 'Bearer token invalid' })
        }

        // Remove prefix if present
        const rawKey = token.startsWith('sk_') ? token.substring(3) : token
        const hint = rawKey.slice(-4)

        // Find active keys with the same hint to narrow down search
        const potentialKeys = await ApiKey.query()
            .where('hint', hint)
            .where('isActive', true)
            .preload('user')

        let matchedKey: ApiKey | null = null
        for (const apiKey of potentialKeys) {
            const isValid = await hash.verify(apiKey.keyHash, rawKey)
            if (isValid) {
                matchedKey = apiKey
                break
            }
        }

        if (!matchedKey) {
            return response.unauthorized({ message: 'Invalid API key' })
        }

        // Inject user into context
        ; (request as any).user = matchedKey.user
            ; (request as any).apiKey = matchedKey

        return next()
    }
}
