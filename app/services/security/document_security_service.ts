import { DocumentSecurityStrategy } from './document_security_strategy.js'
import { VehicleDocumentSecurity } from './vehicle_document_security.js'
import User from '#models/user'
import Document from '#models/document'

/**
 * Registry pour gérer les stratégies de sécurité des documents
 * 
 * Ce service central permet de :
 * - Enregistrer des stratégies de sécurité par type d'entité (tableName)
 * - Déléguer les vérifications de permissions aux stratégies appropriées
 * - Centraliser la logique de sécurité tout en gardant la flexibilité
 */
export class DocumentSecurityService {
    private strategies = new Map<string, DocumentSecurityStrategy>()

    constructor() {
        // Enregistrement des stratégies par défaut
        this.registerDefaultStrategies()
    }

    /**
     * Enregistre les stratégies de sécurité par défaut
     */
    private registerDefaultStrategies() {
        this.register('Vehicle', new VehicleDocumentSecurity())
        // Futures stratégies :
        // this.register('CompanyDriverSetting', new CompanyDriverSettingDocumentSecurity())
        // this.register('User', new UserDocumentSecurity())
        // this.register('Company', new CompanyDocumentSecurity())
    }

    /**
     * Enregistre une stratégie de sécurité pour un type d'entité
     * @param tableName - Le nom de la table/entité (ex: 'Vehicle', 'User')
     * @param strategy - L'instance de la stratégie de sécurité
     */
    register(tableName: string, strategy: DocumentSecurityStrategy): void {
        this.strategies.set(tableName, strategy)
    }

    /**
     * Récupère la stratégie de sécurité pour un type d'entité
     * @param tableName - Le nom de la table/entité
     * @throws Error si aucune stratégie n'est enregistrée pour ce type
     */
    private getStrategy(tableName: string): DocumentSecurityStrategy {
        const strategy = this.strategies.get(tableName)
        if (!strategy) {
            throw new Error(
                `No security strategy registered for table '${tableName}'. ` +
                `Available strategies: ${Array.from(this.strategies.keys()).join(', ')}`
            )
        }
        return strategy
    }

    /**
     * Vérifie si un utilisateur peut uploader un document
     * @param user - L'utilisateur qui tente l'upload
     * @param tableName - Le type d'entité cible
     * @param tableId - L'ID de l'entité cible
     * @param docType - Le type de document
     */
    async canUpload(user: User, tableName: string, tableId: string, docType: string): Promise<boolean> {
        const strategy = this.getStrategy(tableName)
        return await strategy.canUpload(user, tableId, docType)
    }

    /**
     * Vérifie si un utilisateur peut valider un document
     * @param user - L'utilisateur qui tente la validation
     * @param docId - L'ID du document
     */
    async canValidate(user: User, docId: string): Promise<boolean> {
        const doc = await Document.findOrFail(docId)
        const strategy = this.getStrategy(doc.tableName)
        return await strategy.canValidate(user, docId)
    }

    /**
     * Vérifie si un utilisateur peut supprimer un document
     * @param user - L'utilisateur qui tente la suppression
     * @param docId - L'ID du document
     */
    async canDelete(user: User, docId: string): Promise<boolean> {
        const doc = await Document.findOrFail(docId)
        const strategy = this.getStrategy(doc.tableName)
        return await strategy.canDelete(user, docId)
    }

    /**
     * Vérifie si un utilisateur peut voir un document
     * @param user - L'utilisateur qui tente de voir
     * @param docId - L'ID du document
     */
    async canView(user: User, docId: string): Promise<boolean> {
        const doc = await Document.findOrFail(docId)
        const strategy = this.getStrategy(doc.tableName)
        return await strategy.canView(user, docId)
    }

    /**
     * Vérifie si une stratégie est enregistrée pour un type d'entité
     * @param tableName - Le nom de la table/entité
     */
    hasStrategy(tableName: string): boolean {
        return this.strategies.has(tableName)
    }

    /**
     * Liste tous les types d'entités pour lesquels une stratégie est enregistrée
     */
    getRegisteredTableNames(): string[] {
        return Array.from(this.strategies.keys())
    }
}

// Export singleton
export default new DocumentSecurityService()
