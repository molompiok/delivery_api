import { HttpContext } from '@adonisjs/core/http'
import FileTest from '#models/file_test'
import FileManager from '#services/file_manager'

export default class FileTestsController {
    /**
     * Create FileTest with files
     */
    async store(ctx: HttpContext) {
        const { request, response, auth } = ctx
        const user = auth.user!

        const entity = await FileTest.create({
            name: request.input('name'),
            userId: user.id
        })

        const manager = new FileManager(entity, 'FileTest')

        // Sync avatar (Public, max 1)
        await manager.sync(ctx, {
            column: 'avatar',
            isPublic: true,
            config: { allowedExt: ['png', 'jpg'], maxSize: '2MB', maxFiles: 1 }
        })

        // Sync documents (Encrypted, max 5)
        await manager.sync(ctx, {
            column: 'documents',
            isPublic: false,
            config: { allowedExt: ['pdf'], maxSize: '10MB', maxFiles: 5, encrypt: true }
        })

        await entity.loadFiles()
        return response.created(entity)
    }

    /**
     * Show FileTest with files
     */
    async show({ params, response }: HttpContext) {
        const entity = await FileTest.findOrFail(params.id)
        await entity.loadFiles()
        return response.ok(entity)
    }

    /**
     * Update FileTest with files
     */
    async update(ctx: HttpContext) {
        const { params, request, response } = ctx
        const entity = await FileTest.findOrFail(params.id)

        entity.name = request.input('name') || entity.name
        await entity.save()

        const manager = new FileManager(entity, 'FileTest')
        await manager.sync(ctx, { column: 'avatar', isPublic: true })
        await manager.sync(ctx, { column: 'documents', isPublic: false })

        await entity.loadFiles()
        return response.ok(entity)
    }

    /**
     * Delete FileTest and all its files
     */
    async destroy({ params, response }: HttpContext) {
        const entity = await FileTest.findOrFail(params.id)
        const manager = new FileManager(entity, 'FileTest')

        await manager.deleteAll()
        await entity.delete()

        return response.noContent()
    }

    /**
     * Share files
     */
    async share(ctx: HttpContext) {
        const { params, request, response } = ctx
        const entity = await FileTest.findOrFail(params.id)
        const manager = new FileManager(entity, 'FileTest')

        await manager.share(request.input('column'), {
            read: {
                userIds: request.input('read_user_ids'),
                companyIds: request.input('read_company_ids')
            },
            write: {
                userIds: request.input('write_user_ids'),
                companyIds: request.input('write_company_ids')
            }
        })

        return response.ok({ message: 'Shared successfully' })
    }

    /**
     * Revoke access
     */
    async revoke(ctx: HttpContext) {
        const { params, request, response } = ctx
        const entity = await FileTest.findOrFail(params.id)
        const manager = new FileManager(entity, 'FileTest')

        await manager.revoke(request.input('column'), {
            read: {
                userIds: request.input('read_user_ids'),
                companyIds: request.input('read_company_ids')
            },
            write: {
                userIds: request.input('write_user_ids'),
                companyIds: request.input('write_company_ids')
            }
        })

        return response.ok({ message: 'Access revoked' })
    }
}