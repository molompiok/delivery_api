import type { HttpContext } from '@adonisjs/core/http'
import FileService from '#services/file_service'
import type { FileCategory } from '#models/file'
import vine from '@vinejs/vine'

export default class FileController {
    /**
     * Validator for file upload metadata
     */
    static uploadValidator = vine.compile(
        vine.object({
            tableName: vine.string(),
            tableColumn: vine.string(),
            tableId: vine.string(),
            encrypt: vine.boolean().optional(),
            allowedCategories: vine.array(vine.string()).optional(),
            isPublic: vine.boolean().optional(),
            allowedUserIds: vine.array(vine.string()).optional(),
            allowedCompanyIds: vine.array(vine.string()).optional(),
        })
    )

    /**
     * Validator for file permission update
     */
    static updatePermissionsValidator = vine.compile(
        vine.object({
            isPublic: vine.boolean().optional(),
            allowedUserIds: vine.array(vine.string()).optional(),
            allowedCompanyIds: vine.array(vine.string()).optional(),
        })
    )
    /**
     * Upload a file linked to an entity
     */
    async upload({ request, response, auth }: HttpContext) {
        // 1. Validate Metadata
        const data = await request.validateUsing(FileController.uploadValidator)

        // 2. Handle File
        const file = request.file('file', {
            size: '10mb',
            extnames: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'pdf', 'mp4', 'webm', 'mov', 'avi', 'mpeg', 'json', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'zip', 'rar', 'gz'],
        })

        if (!file) {
            return response.badRequest({ message: 'No file uploaded' })
        }

        if (file.hasErrors) {
            return response.badRequest({ message: file.errors[0].message })
        }

        try {
            const user = auth.user!

            // Validate ownership and get company IDs for push-only docs
            const companyIds = await FileService.validateUploadOwnership(user, data.tableName, data.tableId)

            const result = await FileService.upload(file, {
                tableName: data.tableName,
                tableColumn: data.tableColumn,
                tableId: data.tableId,
                encrypt: data.encrypt,
                allowedCategories: data.allowedCategories as FileCategory[],
                isPublic: data.isPublic,
                allowedUserIds: data.allowedUserIds,
                allowedCompanyIds: companyIds || data.allowedCompanyIds,
            })

            // Unified Document Logic: Link the file to a Document record if applicable
            const Document = (await import('#models/document')).default
            const doc = await Document.query()
                .where('tableName', data.tableName)
                .where('tableId', data.tableId)
                .where('documentType', data.tableColumn.replace('dct_', ''))
                .first()

            if (doc) {
                doc.fileId = result.fileId
                doc.status = 'PENDING' // Reset to pending for manager review after upload/re-upload
                doc.addHistory('FILE_UPLOADED', user, { fileId: result.fileId, fileName: result.name })
                await doc.save()

                if (doc.tableName === 'CompanyDriverSetting') {
                    const CompanyService = (await import('#services/company_service')).default
                    await CompanyService.syncDocsStatus(doc.tableId)
                }
            }

            return response.created({
                message: 'File uploaded successfully',
                file: result,
                documentId: doc?.id
            })
        } catch (error: any) {
            if (error.message.includes('only') || error.message.includes('not authorized')) {
                return response.forbidden({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Upload multiple fichiers
     */
    async uploadMultiple({ request, response }: HttpContext) {
        const files = request.files('files', {
            size: '10mb',
            extnames: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'pdf', 'mp4', 'webm', 'mov', 'avi', 'mpeg', 'json', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'zip', 'rar', 'gz'],
        })

        if (!files || files.length === 0) {
            return response.badRequest({ message: 'No files uploaded' })
        }

        const {
            tableName, tableColumn, tableId, encrypt, allowedCategories,
            isPublic, allowedUserIds, allowedCompanyIds
        } = request.only([
            'tableName', 'tableColumn', 'tableId', 'encrypt', 'allowedCategories',
            'isPublic', 'allowedUserIds', 'allowedCompanyIds'
        ])

        if (!tableName || !tableColumn || !tableId) {
            return response.badRequest({
                message: 'tableName, tableColumn and tableId are required'
            })
        }

        // Parse allowedCategories if provided
        let parsedCategories: FileCategory[] | undefined
        if (allowedCategories) {
            if (typeof allowedCategories === 'string') {
                parsedCategories = allowedCategories.split(',').map(c => c.trim()) as FileCategory[]
            } else if (Array.isArray(allowedCategories)) {
                parsedCategories = allowedCategories as FileCategory[]
            }
        }

        // Parse allowedUserIds and allowedCompanyIds
        let parsedUserIds: string[] | undefined
        let parsedCompanyIds: string[] | undefined

        if (allowedUserIds) {
            parsedUserIds = typeof allowedUserIds === 'string'
                ? allowedUserIds.split(',').map(s => s.trim())
                : allowedUserIds
        }
        if (allowedCompanyIds) {
            parsedCompanyIds = typeof allowedCompanyIds === 'string'
                ? allowedCompanyIds.split(',').map(s => s.trim())
                : allowedCompanyIds
        }

        try {
            const results = await FileService.uploadMultiple(files, {
                tableName,
                tableColumn,
                tableId,
                encrypt: encrypt === 'true' || encrypt === true,
                allowedCategories: parsedCategories,
                isPublic: isPublic === 'true' || isPublic === true,
                allowedUserIds: parsedUserIds,
                allowedCompanyIds: parsedCompanyIds,
            })

            return response.created({
                message: `${results.length} files uploaded successfully`,
                files: results,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Lister les fichiers d'une entité (avec vérification des permissions)
     */
    async listFor({ params, request, response, auth }: HttpContext) {
        try {
            const { tableName, tableId } = params
            const tableColumn = request.input('column')
            const user = auth.user || null
            const files = await FileService.listFilesWithAccess(user, tableName, tableId, tableColumn)
            return response.ok(files)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List files for the authenticated user's managed company
     */
    async listMyCompanyFiles({ request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            if (!activeCompanyId) {
                return response.badRequest({ message: 'User is not associated with a company' })
            }
            const tableColumn = request.input('column')
            const files = await FileService.listFilesWithAccess(user, 'Company', activeCompanyId, tableColumn)
            return response.ok(files)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Télécharger un fichier (avec vérification des permissions)
     */
    async download({ params, response, auth }: HttpContext) {
        try {
            const { fileId } = params
            const user = auth.user || null

            const file = await FileService.getFile(fileId)
            if (!file) {
                return response.notFound({ message: 'File not found' })
            }

            const canAccess = await FileService.canUserAccessFile(file, user)
            if (!canAccess) {
                return response.forbidden({ message: 'You do not have permission to access this file' })
            }

            const { content, mimeType, name } = await FileService.readFile(fileId)
            response.header('Content-Type', mimeType)
            response.header('Content-Disposition', `attachment; filename="${name}"`)
            return response.send(content)
        } catch (error: any) {
            return response.notFound({ message: 'File not found' })
        }
    }

    /**
     * Afficher un fichier (inline, avec vérification des permissions)
     */
    async view({ params, response, auth }: HttpContext) {
        try {
            const { fileId } = params
            const user = auth.user || null

            const file = await FileService.getFile(fileId)
            if (!file) {
                return response.notFound({ message: 'File not found' })
            }

            const canAccess = await FileService.canUserAccessFile(file, user)
            if (!canAccess) {
                return response.forbidden({ message: 'You do not have permission to access this file' })
            }

            const { content, mimeType, name } = await FileService.readFile(fileId)
            response.header('Content-Type', mimeType)
            response.header('Content-Disposition', `inline; filename="${name}"`)
            return response.send(content)
        } catch (error: any) {
            return response.notFound({ message: 'File not found' })
        }
    }

    /**
     * Supprimer un fichier (owner/admin only)
     */
    async delete({ params, response, auth }: HttpContext) {
        try {
            const { fileId } = params
            const user = auth.user!

            const canDelete = await FileService.canUserDeleteFile(user, fileId)
            if (!canDelete) {
                return response.forbidden({ message: 'You do not have permission to delete this file' })
            }

            await FileService.deleteFile(fileId)
            return response.ok({ message: 'File deleted successfully' })
        } catch (error: any) {
            return response.notFound({ message: 'File not found' })
        }
    }

    /**
     * Supprimer tous les fichiers d'une entité (owner/admin only)
     */
    async deleteFor({ params, request, response, auth }: HttpContext) {
        try {
            const { tableName, tableId } = params
            const tableColumn = request.input('column')
            const user = auth.user!

            const isOwner = tableName === 'User' && tableId === user.id
            if (!isOwner && !user.isAdmin) {
                return response.forbidden({ message: 'You do not have permission to delete these files' })
            }

            const count = await FileService.deleteFilesFor(tableName, tableId, tableColumn)
            return response.ok({
                message: `${count} file(s) deleted successfully`,
                count,
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Update file permissions (owner/admin only)
     */
    async updatePermissions({ params, request, response, auth }: HttpContext) {
        try {
            const { fileId } = params
            const user = auth.user!
            const data = await request.validateUsing(FileController.updatePermissionsValidator)

            const canUpdate = await FileService.canUserUpdateFile(user, fileId)
            if (!canUpdate) {
                return response.forbidden({ message: 'You do not have permission to update this file' })
            }

            const updatedFile = await FileService.updatePermissions(fileId, data)

            return response.ok({
                message: 'File permissions updated',
                file: updatedFile,
            })
        } catch (error: any) {
            return response.notFound({ message: 'File not found' })
        }
    }

    /**
     * Get category info with allowed MIME types
     */
    async categories({ response }: HttpContext) {
        const categories = FileService.getCategoryInfo()
        return response.ok(categories)
    }
}
