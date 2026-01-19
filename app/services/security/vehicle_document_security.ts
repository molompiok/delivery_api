import { DocumentSecurityStrategy } from './document_security_strategy.js'
import User from '#models/user'
import Vehicle from '#models/vehicle'
import Document from '#models/document'

/**
 * Stratégie de sécurité pour les documents de véhicules
 * 
 * Règles de sécurité :
 * - Upload : Propriétaire du véhicule (User direct OU Manager de la Company)
 * - Validation : Admins Sublymus uniquement (pour vérifier authenticité des docs légaux)
 * - Suppression : Propriétaire du véhicule OU Admins
 * - Visualisation : Propriétaire du véhicule OU Admins
 */
export class VehicleDocumentSecurity implements DocumentSecurityStrategy {
    /**
     * Vérifie si l'utilisateur peut uploader un document pour ce véhicule
     */
    async canUpload(user: User, tableId: string, _docType: string): Promise<boolean> {
        try {
            const vehicle = await Vehicle.findOrFail(tableId)

            // Admin peut toujours uploader
            if (user.isAdmin) {
                return true
            }

            // Véhicule appartenant à un utilisateur
            if (vehicle.ownerType === 'User') {
                return user.id === vehicle.ownerId
            }

            // Véhicule appartenant à une entreprise
            if (vehicle.ownerType === 'Company') {
                // Le manager de l'entreprise peut uploader
                return user.companyId === vehicle.ownerId && !!user.currentCompanyManaged
            }

            return false
        } catch (error) {
            // Si le véhicule n'existe pas, refuser l'accès
            return false
        }
    }

    /**
     * Vérifie si l'utilisateur peut valider un document de véhicule
     * 
     * Règle : Seuls les admins Sublymus peuvent valider les documents légaux
     * (assurance, visite technique, carte grise) pour garantir leur authenticité
     */
    async canValidate(user: User, _docId: string): Promise<boolean> {
        // Seuls les admins Sublymus peuvent valider les documents de véhicule
        return user.isAdmin
    }

    /**
     * Vérifie si l'utilisateur peut supprimer un document de véhicule
     */
    async canDelete(user: User, docId: string): Promise<boolean> {
        try {
            const doc = await Document.findOrFail(docId)
            const vehicle = await Vehicle.findOrFail(doc.tableId)

            // Admin peut toujours supprimer
            if (user.isAdmin) {
                return true
            }

            // Propriétaire du véhicule peut supprimer
            if (vehicle.ownerType === 'User') {
                return user.id === vehicle.ownerId
            }

            if (vehicle.ownerType === 'Company') {
                return user.companyId === vehicle.ownerId && !!user.currentCompanyManaged
            }

            return false
        } catch (error) {
            return false
        }
    }

    /**
     * Vérifie si l'utilisateur peut voir un document de véhicule
     */
    async canView(user: User, docId: string): Promise<boolean> {
        try {
            const doc = await Document.findOrFail(docId)
            const vehicle = await Vehicle.findOrFail(doc.tableId)

            // Admin peut toujours voir
            if (user.isAdmin) {
                return true
            }

            // Propriétaire du véhicule peut voir
            if (vehicle.ownerType === 'User') {
                return user.id === vehicle.ownerId
            }

            if (vehicle.ownerType === 'Company') {
                // Manager de l'entreprise peut voir
                if (user.companyId === vehicle.ownerId && !!user.currentCompanyManaged) {
                    return true
                }

                // Driver assigné au véhicule peut voir ses propres documents
                if (vehicle.assignedDriverId === user.id) {
                    return true
                }
            }

            return false
        } catch (error) {
            return false
        }
    }
}
