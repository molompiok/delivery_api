import type { HttpContext } from '@adonisjs/core/http'
import Document from '#models/document'
import User from '#models/user'
import { DateTime } from 'luxon'

export default class DocumentController {
    /**
     * List documents for a specific table and ID (Admin/Owner)
     */
    async listDocuments({ params, request, response }: HttpContext) {
        try {
            const { tableName, tableId } = params
            const { status } = request.qs()

            const query = Document.query()
                .where('tableName', tableName)
                .where('tableId', tableId)
                .where('isDeleted', false)
                .preload('file')

            if (status) {
                query.where('status', status)
            }

            const documents = await query.orderBy('createdAt', 'desc')
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
            const document = await Document.query()
                .where('id', params.docId)
                .preload('file')
                .firstOrFail()

            return response.ok(document)
        } catch (error: any) {
            return response.notFound({ message: 'Document not found' })
        }
    }

    /**
     * Validate/Reject a document (Admin only for global User documents)
     */
    async validateDocument({ params, request, response, auth }: HttpContext) {
        try {
            const user = auth.user!

            // Only admins can validate global documents
            if (!user.isAdmin) {
                return response.forbidden({ message: 'Admin access required' })
            }

            const { status, comment } = request.only(['status', 'comment'])

            if (!['APPROVED', 'REJECTED'].includes(status)) {
                return response.badRequest({ message: 'Status must be APPROVED or REJECTED' })
            }

            const document = await Document.findOrFail(params.docId)

            // Only allow validation of User documents (global Sublymus docs)
            if (document.tableName !== 'User') {
                return response.forbidden({
                    message: 'This endpoint is only for global User documents. Company documents should be validated via company routes.'
                })
            }

            // Update document status
            document.status = status as any
            document.validationComment = comment || null
            document.addHistory('ADMIN_VALIDATION', user, { status, comment })
            await document.save()

            // Update driver verification status if all docs are approved
            if (status === 'APPROVED') {
                await this.checkAndUpdateDriverVerificationStatus(document.tableId)
            }

            return response.ok({
                message: `Document ${status.toLowerCase()}`,
                document
            })
        } catch (error: any) {
            if (error.code === 'E_ROW_NOT_FOUND') {
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

            if (!user.isAdmin) {
                return response.forbidden({ message: 'Admin access required' })
            }

            const { expireAt } = request.only(['expireAt'])

            const document = await Document.findOrFail(params.docId)
            document.expireAt = expireAt ? DateTime.fromISO(expireAt) : null
            document.addHistory('EXPIRY_SET', user, { expireAt })
            await document.save()

            return response.ok({
                message: 'Document expiry date updated',
                document
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Helper: Check if all required documents are approved and update driver verification status
     */
    private async checkAndUpdateDriverVerificationStatus(userId: string) {
        const DriverSetting = (await import('#models/driver_setting')).default

        // Get all User documents for this driver
        const documents = await Document.query()
            .where('tableName', 'User')
            .where('tableId', userId)
            .where('isDeleted', false)

        // Check if all documents are approved (or if there are no documents required)
        const allApproved = documents.length > 0 && documents.every(doc => doc.status === 'APPROVED')

        if (allApproved) {
            // Update driver verification status
            const driverSetting = await DriverSetting.query()
                .where('userId', userId)
                .first()

            if (driverSetting && driverSetting.verificationStatus !== 'VERIFIED') {
                driverSetting.verificationStatus = 'VERIFIED'
                await driverSetting.save()
            }
        }
    }
}
