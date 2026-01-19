import User from '#models/user'

/**
 * Interface commune pour toutes les stratégies de sécurité des documents
 */
export interface DocumentSecurityStrategy {
    /**
     * Vérifie si un utilisateur peut uploader un document pour une entité
     * @param user - L'utilisateur qui tente l'upload
     * @param tableId - L'ID de l'entité cible
     * @param docType - Le type de document (ex: 'PERMIS', 'VEHICLE_INSURANCE')
     */
    canUpload(user: User, tableId: string, docType: string): Promise<boolean>

    /**
     * Vérifie si un utilisateur peut valider/rejeter un document
     * @param user - L'utilisateur qui tente la validation
     * @param docId - L'ID du document
     */
    canValidate(user: User, docId: string): Promise<boolean>

    /**
     * Vérifie si un utilisateur peut supprimer un document
     * @param user - L'utilisateur qui tente la suppression
     * @param docId - L'ID du document
     */
    canDelete(user: User, docId: string): Promise<boolean>

    /**
     * Vérifie si un utilisateur peut voir un document
     * @param user - L'utilisateur qui tente de voir
     * @param docId - L'ID du document
     */
    canView(user: User, docId: string): Promise<boolean>
}
