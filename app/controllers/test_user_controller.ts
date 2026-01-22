import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import FileManager from '#services/file_manager'
import vine from '@vinejs/vine'

export default class TestUserController {
    /**
     * POST /test-users
     * Integrated creation of User + Photos
     */
    async store(ctx: HttpContext) {
        const { request, response } = ctx

        // 1. Validation basics (Simplified for demo)
        const payload = await request.validateUsing(vine.compile(vine.object({
            fullName: vine.string(),
            email: vine.string().email(),
            phone: vine.string()
        })))

        // 2. Create User in DB
        const user = await User.create(payload)

        // 3. Handle Files via FileManager
        const manager = new FileManager(user, 'User')

        // Photos: Public
        await manager.sync(ctx, {
            column: 'photos',
            isPublic: true
        })

        // Address Photos: Private
        await manager.sync(ctx, {
            column: 'address_photos',
            isPublic: false
        })

        // 4. Load files to return them in JSON
        await user.loadFiles()

        return response.created(user)
    }

    /**
     * PUT /test-users/:id
     * Integrated Update
     */
    async update(ctx: HttpContext) {
        const { params, request, response } = ctx
        const user = await User.findOrFail(params.id)

        // 1. Update data
        user.merge(request.only(['fullName', 'email']))
        await user.save()

        // 2. Sync Files (Deletes + Updates + Creates)
        const manager = new FileManager(user, 'User')

        await manager.sync(ctx, { column: 'photos', isPublic: true })
        await manager.sync(ctx, { column: 'address_photos', isPublic: false })

        // 3. Return updated state
        await user.loadFiles()
        return response.ok(user)
    }

    /**
     * GET /test-users/:id
     */
    async show({ params, response }: HttpContext) {
        const user = await User.findOrFail(params.id)
        await user.loadFiles()
        return response.ok(user)
    }
}
