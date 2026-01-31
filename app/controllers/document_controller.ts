import type { HttpContext } from '@adonisjs/core/http'
import DocumentService from '#services/document_service'
import { inject } from '@adonisjs/core'

@inject()
export default class DocumentController {
    constructor(protected documentService: DocumentService) { }

    /**
     * List documents for a specific table and ID
     */
    async listDocuments({ params, request, response }: HttpContext) {
        try {
            const { tableName, tableId } = params
            const { status } = request.qs()

            const documents = await this.documentService.listDocuments(tableName, tableId, status)
            return response.ok(documents)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Get a single document
     */
    async getDocument({ params, response }: HttpContext) {
        try {
            const document = await this.documentService.getDocument(params.docId)
            return response.ok(document)
        } catch (error: any) {
            return response.notFound({ message: 'Document not found' })
        }
    }

    /**
     * Validate/Reject a global document (Admin only)
     */
    async validateDocument({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const { status, comment } = request.only(['status', 'comment'])

            if (!['APPROVED', 'REJECTED'].includes(status)) {
                return response.badRequest({ message: 'Status must be APPROVED or REJECTED' })
            }

            const document = await this.documentService.validateDocument(user, params.docId, status as any, comment)

            return response.ok({
                message: `Document ${status.toLowerCase()}`,
                document
            })
        } catch (error: any) {
            if (error.code === 'E_ROW_NOT_FOUND' || error.message.includes('not found')) {
                return response.notFound({ message: 'Document not found' })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Set expiry date for a document (Admin)
     */
    async setExpiry({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const { expireAt } = request.only(['expireAt'])

            const document = await this.documentService.setExpiry(user, params.docId, expireAt)

            return response.ok({
                message: 'Document expiry date updated',
                document
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Submit a file for a specific document placeholder
     */
    async submitFile({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const { fileId, expiryDate } = request.only(['fileId', 'expiryDate'])

            if (!fileId) {
                return response.badRequest({ message: 'fileId is required' })
            }

            const document = await this.documentService.submitFile(user, params.docId, fileId, expiryDate)

            return response.ok({
                message: 'Document submitted successfully',
                document
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Admin: Add a document placeholder to all existing drivers
     */
    async bulkAddDocument({ request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const { documentType, label } = request.only(['documentType', 'label'])

            if (!documentType || !label) {
                return response.badRequest({ message: 'documentType and label are required' })
            }

            const count = await this.documentService.bulkAddDocument(user, documentType, label)

            return response.ok({ message: `Document placeholder created for ${count} drivers` })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Admin: Remove a document type from all existing drivers
     */
    async bulkRemoveDocument({ request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const { documentType } = request.only(['documentType'])

            if (!documentType) {
                return response.badRequest({ message: 'documentType is required' })
            }

            const count = await this.documentService.bulkRemoveDocument(user, documentType)

            return response.ok({ message: `Removed document ${documentType} from ${count} drivers` })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Admin: Add a document to a specific driver
     */
    async addDocumentToDriver({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            const { driverId } = params // This is the userId
            const { documentType, label } = request.only(['documentType', 'label'])

            const doc = await this.documentService.addDocumentToDriver(user, driverId, documentType, label)

            return response.created({ message: 'Document added to driver', document: doc })
        } catch (error: any) {
            if (error.message.includes('already exists')) {
                return response.conflict({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Admin: Remove a specific document from a driver
     */
    async removeDocumentFromDriver({ params, response, auth }: HttpContext) {
        try {
            const user = auth.user!
            await this.documentService.removeDocument(user, params.docId)

            return response.ok({ message: 'Document removed from driver' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
