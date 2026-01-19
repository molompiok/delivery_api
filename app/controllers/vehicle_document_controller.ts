import type { HttpContext } from '@adonisjs/core/http'
import VehicleService from '#services/vehicle_service'
import DocumentSecurityService from '#services/security/document_security_service'

export default class VehicleDocumentController {
    /**
     * Valider un document de véhicule (Admin Sublymus uniquement)
     */
    async validate({ params, request, response, auth }: HttpContext) {
        const user = auth.user!
        const { docId } = params
        const { status, comment } = request.body()

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return response.badRequest({ message: 'Invalid status. Must be APPROVED or REJECTED' })
        }

        try {
            // Vérification de sécurité
            const canValidate = await DocumentSecurityService.canValidate(user, docId)

            if (!canValidate) {
                return response.forbidden({
                    message: 'Only Sublymus admins can validate vehicle documents'
                })
            }

            const doc = await VehicleService.validateDocument(user, docId, status, comment)

            return response.ok({
                message: `Document ${status.toLowerCase()}`,
                document: doc
            })
        } catch (error) {
            if (error.code === 'E_ROW_NOT_FOUND') {
                return response.notFound({ message: 'Document not found' })
            }
            return response.badRequest({ message: error.message })
        }
    }
}
