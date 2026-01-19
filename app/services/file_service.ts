import fs from 'node:fs/promises'
import path from 'node:path'
import { MultipartFile } from '@adonisjs/core/bodyparser'
import File, { type FileCategory } from '#models/file'
import User from '#models/user'
import { generateId } from '../utils/id_generator.js'
import encryption from '@adonisjs/core/services/encryption'

/**
 * Mapping of MIME types to FileCategory
 * Each category can have specific processing operations later
 */

const MIME_TO_CATEGORY: Record<string, FileCategory> = {
    // IMAGE category - can be: compressed, scaled, resized, rotated, effects added
    'image/jpeg': 'IMAGE',
    'image/png': 'IMAGE',
    'image/webp': 'IMAGE',
    'image/gif': 'IMAGE',
    'image/svg+xml': 'IMAGE',
    'image/bmp': 'IMAGE',

    // VIDEO category - can be: transcoded, thumbnailed, compressed
    'video/mp4': 'VIDEO',
    'video/webm': 'VIDEO',
    'video/quicktime': 'VIDEO',
    'video/x-msvideo': 'VIDEO',
    'video/mpeg': 'VIDEO',

    // DOCS category - can be: previewed, converted
    'application/pdf': 'DOCS',
    'application/msword': 'DOCS',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCS',
    'application/vnd.ms-excel': 'DOCS',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'DOCS',
    'text/plain': 'DOCS',
    'text/csv': 'DOCS',

    // JSON category - can be: parsed, validated
    'application/json': 'JSON',

    // BINARY category - raw storage only
    'application/octet-stream': 'BINARY',
    'application/zip': 'BINARY',
    'application/x-rar-compressed': 'BINARY',
    'application/gzip': 'BINARY',
}

/**
 * All allowed MIME types (extracted from MIME_TO_CATEGORY)
 */
const ALLOWED_MIME_TYPES = Object.keys(MIME_TO_CATEGORY)

export interface UploadOptions {
    tableName: string           // 'User', 'Vehicle', 'Company'
    tableColumn: string         // 'docs', 'photos', 'logo'
    tableId: string             // ID de l'entité (user_xxx, veh_xxx)
    encrypt?: boolean           // Chiffrer les fichiers sensibles
    allowedCategories?: FileCategory[]  // Optionnel: restreindre les catégories acceptées
    // Permissions
    isPublic?: boolean          // Accessible sans authentification
    allowedUserIds?: string[]   // IDs des utilisateurs autorisés
    allowedCompanyIds?: string[] // IDs des companies dont les managers sont autorisés
    metadata?: Record<string, any> // Ex: { expiryDate: '2026-01-01' }
}

export interface UploadResult {
    fileId: string
    path: string
    name: string
    mimeType: string
    size: number
    fileCategory: FileCategory
    isPublic: boolean
    metadata?: Record<string, any>
}

class FileService {
    private uploadDir = process.env.UPLOAD_DIR || './uploads'
    private maxFileSize = 10 * 1024 * 1024 // 10MB

    /**
     * Get FileCategory from MIME type
     */
    private getCategoryFromMime(mimeType: string): FileCategory {
        return MIME_TO_CATEGORY[mimeType] || 'OTHER'
    }

    /**
     * Check if MIME type is allowed
     */
    private isMimeTypeAllowed(mimeType: string, allowedCategories?: FileCategory[]): boolean {
        // If no category restriction, check if MIME is in our allowed list
        if (!allowedCategories || allowedCategories.length === 0) {
            return ALLOWED_MIME_TYPES.includes(mimeType)
        }

        // Check if the MIME type's category is in allowed categories
        const category = this.getCategoryFromMime(mimeType)
        return allowedCategories.includes(category)
    }

    /**
     * Get allowed MIME types for specific categories
     */
    getMimeTypesForCategories(categories: FileCategory[]): string[] {
        return Object.entries(MIME_TO_CATEGORY)
            .filter(([_, category]) => categories.includes(category))
            .map(([mimeType]) => mimeType)
    }

    /**
     * Upload un fichier et crée l'entrée en base
     */
    async upload(file: MultipartFile, options: UploadOptions): Promise<UploadResult> {
        // Validation
        if (!file.tmpPath) {
            throw new Error('File not uploaded')
        }

        if (file.size > this.maxFileSize) {
            throw new Error(`File too large. Max size: ${this.maxFileSize / 1024 / 1024}MB`)
        }

        // Construct full MIME type from type and subtype
        const mimeType = file.type && file.subtype
            ? `${file.type}/${file.subtype}`
            : 'application/octet-stream'

        // Check if MIME type is allowed (considering category restrictions)
        if (!this.isMimeTypeAllowed(mimeType, options.allowedCategories)) {
            const category = this.getCategoryFromMime(mimeType)
            if (options.allowedCategories) {
                throw new Error(`File category '${category}' not allowed. Accepted: ${options.allowedCategories.join(', ')}`)
            }
            throw new Error(`File type not allowed: ${mimeType}`)
        }

        const fileCategory = this.getCategoryFromMime(mimeType)

        // Générer le nom de fichier unique
        const fileId = generateId('fil')
        const timestamp = Buffer.from(Date.now().toString()).toString('base64url').slice(0, 4)
        const random = Buffer.from(Math.random().toString()).toString('base64url').slice(0, 4)
        const ext = file.extname || 'bin'
        const fileName = `${options.tableColumn}_${fileId}_${timestamp}_${random}.${ext}`

        // Créer le répertoire si nécessaire
        const entityDir = path.join(this.uploadDir, options.tableName.toLowerCase(), options.tableId)
        await fs.mkdir(entityDir, { recursive: true })

        const filePath = path.join(entityDir, fileName)

        // Lire le fichier
        let fileContent = await fs.readFile(file.tmpPath)

        // Chiffrement si requis (documents sensibles)
        if (options.encrypt) {
            fileContent = Buffer.from(encryption.encrypt(fileContent.toString('base64')))
        }

        // Écrire le fichier
        await fs.writeFile(filePath, fileContent)

        // Créer l'entrée en base
        const fileRecord = await File.create({
            id: fileId,
            path: filePath,
            name: file.clientName,
            tableName: options.tableName,
            tableColumn: options.tableColumn,
            tableId: options.tableId,
            mimeType: mimeType,
            size: file.size,
            isEncrypted: options.encrypt || false,
            fileCategory: fileCategory,
            metadata: options.metadata || null,
            // Permissions
            isPublic: options.isPublic || false,
            allowedUserIds: options.allowedUserIds || [],
            allowedCompanyIds: options.allowedCompanyIds || [],
        })


        return {
            fileId: fileRecord.id,
            path: fileRecord.path,
            name: fileRecord.name,
            mimeType: fileRecord.mimeType || 'application/octet-stream',
            size: fileRecord.size || 0,
            fileCategory: fileRecord.fileCategory,
            isPublic: fileRecord.isPublic,
            metadata: fileRecord.metadata || undefined,
        }
    }

    /**
     * Copy an existing file to a new location/owner (physical copy)
     */
    async copyFile(fileId: string, newOptions: UploadOptions): Promise<UploadResult> {
        const sourceFile = await File.findOrFail(fileId)

        // Generate new ID and path
        const fileIdNew = generateId('fil')
        const timestamp = Buffer.from(Date.now().toString()).toString('base64url').slice(0, 4)
        const random = Buffer.from(Math.random().toString()).toString('base64url').slice(0, 4)
        const ext = path.extname(sourceFile.path).slice(1) || 'bin'
        const fileName = `${newOptions.tableColumn}_${fileIdNew}_${timestamp}_${random}.${ext}`

        // Create directory
        const entityDir = path.join(this.uploadDir, newOptions.tableName.toLowerCase(), newOptions.tableId)
        await fs.mkdir(entityDir, { recursive: true })
        const targetPath = path.join(entityDir, fileName)

        // Physical copy
        await fs.copyFile(sourceFile.path, targetPath)

        // Create DB entry
        const fileRecord = await File.create({
            id: fileIdNew,
            path: targetPath,
            name: sourceFile.name,
            tableName: newOptions.tableName,
            tableColumn: newOptions.tableColumn,
            tableId: newOptions.tableId,
            mimeType: sourceFile.mimeType,
            size: sourceFile.size,
            isEncrypted: sourceFile.isEncrypted,
            fileCategory: sourceFile.fileCategory,
            isPublic: newOptions.isPublic || false,
            allowedUserIds: newOptions.allowedUserIds || [],
            allowedCompanyIds: newOptions.allowedCompanyIds || [],
        })

        return {
            fileId: fileRecord.id,
            path: fileRecord.path,
            name: fileRecord.name,
            mimeType: fileRecord.mimeType || 'application/octet-stream',
            size: fileRecord.size || 0,
            fileCategory: fileRecord.fileCategory,
            isPublic: fileRecord.isPublic,
        }
    }

    /**
     * Upload multiple fichiers
     */
    async uploadMultiple(files: MultipartFile[], options: UploadOptions): Promise<UploadResult[]> {
        const results: UploadResult[] = []
        for (const file of files) {
            const result = await this.upload(file, options)
            results.push(result)
        }
        return results
    }

    /**
     * Récupérer les fichiers d'une entité
     */
    async getFilesFor(tableName: string, tableId: string, tableColumn?: string): Promise<File[]> {
        const query = File.query()
            .where('tableName', tableName)
            .where('tableId', tableId)

        if (tableColumn) {
            query.where('tableColumn', tableColumn)
        }

        return query.orderBy('createdAt', 'desc')
    }

    /**
     * Récupérer les fichiers par catégorie
     */
    async getFilesByCategory(tableName: string, tableId: string, fileCategory: FileCategory): Promise<File[]> {
        return File.query()
            .where('tableName', tableName)
            .where('tableId', tableId)
            .where('fileCategory', fileCategory)
            .orderBy('createdAt', 'desc')
    }

    /**
     * Lire le contenu d'un fichier (avec déchiffrement si nécessaire)
     */
    async readFile(fileId: string): Promise<{ content: Buffer; mimeType: string; name: string; fileCategory: FileCategory }> {
        const file = await File.findOrFail(fileId)

        let content = await fs.readFile(file.path)

        if (file.isEncrypted) {
            const decrypted = encryption.decrypt(content.toString())
            if (decrypted && typeof decrypted === 'string') {
                content = Buffer.from(decrypted, 'base64') as unknown as typeof content
            }
        }

        return {
            content,
            mimeType: file.mimeType || 'application/octet-stream',
            name: file.name,
            fileCategory: file.fileCategory,
        }
    }

    /**
     * Supprimer un fichier
     */
    async deleteFile(fileId: string): Promise<void> {
        const file = await File.findOrFail(fileId)

        // Supprimer le fichier physique
        try {
            await fs.unlink(file.path)
        } catch {
            // Fichier peut déjà être supprimé
        }

        // Supprimer l'entrée en base
        await file.delete()
    }

    /**
     * Supprimer les fichiers d'une entité
     * @param tableName - Nom de la table (User, Vehicle, etc.)
     * @param tableId - ID de l'entité
     * @param tableColumn - Optionnel: colonne spécifique (docs, photos, logo). Si non défini, supprime tous les fichiers de l'entité.
     */
    async deleteFilesFor(tableName: string, tableId: string, tableColumn?: string): Promise<number> {
        const files = await this.getFilesFor(tableName, tableId, tableColumn)

        for (const file of files) {
            await this.deleteFile(file.id)
        }

        return files.length
    }

    /**
     * Vérifier si un fichier existe
     */
    async fileExists(fileId: string): Promise<boolean> {
        const file = await File.find(fileId)
        return file !== null
    }

    /**
     * Obtenir un fichier par ID
     */
    async getFile(fileId: string): Promise<File | null> {
        return File.find(fileId)
    }

    /**
     * Get all allowed MIME types
     */
    getAllowedMimeTypes(): string[] {
        return ALLOWED_MIME_TYPES
    }

    /**
     * Get category info with allowed MIME types
     */
    getCategoryInfo(): Record<FileCategory, string[]> {
        const info: Record<FileCategory, string[]> = {
            IMAGE: [],
            VIDEO: [],
            DOCS: [],
            JSON: [],
            BINARY: [],
            OTHER: [],
        }

        for (const [mimeType, category] of Object.entries(MIME_TO_CATEGORY)) {
            info[category].push(mimeType)
        }

        return info
    }

    /**
     * Check if a user can access a file
     * Access is granted if:
     * - File is public
     * - User is admin
     * - User is the owner (tableId matches user.id for User table)
     * - User is in allowedUserIds
     * - User is a manager of a company in allowedCompanyIds
     */
    /**
     * Check if a user can access a file
     * Access is granted if:
     * - File is public
     * - User is admin
     * - User is the owner (tableId matches user.id for User table)
     * - User is the manager of the company (for Company table files)
     * - User is in allowedUserIds
     * - User manages a company that's in allowedCompanyIds
     * 
     * SPECIAL: For 'CompanyDriverSetting' files, access is DENIED for drivers (push-only)
     */
    async canUserAccessFile(file: File, user: User | null): Promise<boolean> {
        // Public files are accessible by anyone
        if (file.isPublic) {
            return true
        }

        // No user = no access to non-public files
        if (!user) {
            return false
        }

        // Admins can access anything
        if (user.isAdmin) {
            return true
        }

        // SPECIAL: Push-only rule for CompanyDriverSetting
        // Drivers cannot see files once shared/mirrored to the company relation
        if (file.tableName === 'CompanyDriverSetting') {
            const activeCompanyId = user.currentCompanyManaged || user.companyId
            // Only the company manager (or admin, checked above) can see it
            if (activeCompanyId && file.allowedCompanyIds?.includes(activeCompanyId)) {
                return true
            }
            return false
        }

        // Owner can access their own files (User table)
        if (file.tableName === 'User' && file.tableId === user.id) {
            return true
        }

        // Owner can access their own files (Company table - administrative docs)
        const activeCompanyId = user.currentCompanyManaged || user.companyId
        if (file.tableName === 'Company' && activeCompanyId && file.tableId === activeCompanyId) {
            return true
        }

        // Owner can access their own files (Vehicle table)
        if (file.tableName === 'Vehicle') {
            const Vehicle = (await import('#models/vehicle')).default
            const vehicle = await Vehicle.find(file.tableId)
            if (vehicle) {
                if (vehicle.ownerType === 'User' && vehicle.ownerId === user.id) return true
                if (vehicle.ownerType === 'Company' && activeCompanyId === vehicle.ownerId) return true
            }
        }

        // Check explicit permissions
        if (file.allowedUserIds?.includes(user.id)) {
            return true
        }

        if (activeCompanyId && file.allowedCompanyIds?.includes(activeCompanyId)) {
            return true
        }

        return false
    }

    /**
     * Validate upload ownership and return company IDs for push-only docs
     */
    async validateUploadOwnership(user: User, tableName: string, tableId: string): Promise<string[] | null> {
        const activeCompanyId = user.currentCompanyManaged || user.companyId

        if (!user.isAdmin) {
            if (tableName === 'User' && tableId !== user.id) {
                throw new Error('You can only upload files for your own account')
            }
            if (tableName === 'Company' && tableId !== activeCompanyId) {
                throw new Error('You can only upload files for your managed company')
            }
            if (tableName === 'CompanyDriverSetting') {
                const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
                const relation = await CompanyDriverSetting.find(tableId)
                if (!relation || relation.driverId !== user.id) {
                    throw new Error('You are not authorized to upload to this relationship')
                }
                // Return company ID for push-only docs
                return [relation.companyId]
            }
            if (tableName === 'Vehicle') {
                const Vehicle = (await import('#models/vehicle')).default
                const vehicle = await Vehicle.find(tableId)
                if (!vehicle) throw new Error('Vehicle not found')

                const isOwner = (vehicle.ownerType === 'User' && vehicle.ownerId === user.id) ||
                    (vehicle.ownerType === 'Company' && vehicle.ownerId === activeCompanyId)

                if (!isOwner) {
                    throw new Error('You are not authorized to upload to this vehicle')
                }
                return vehicle.ownerType === 'Company' ? [vehicle.ownerId] : null
            }
        }
        return null
    }

    /**
     * Check if user can delete a file
     */
    async canUserDeleteFile(user: User, fileId: string): Promise<boolean> {
        const file = await this.getFile(fileId)
        if (!file) {
            return false
        }

        if (user.isAdmin) {
            return true
        }

        const activeCompanyId = user.currentCompanyManaged || user.companyId
        let isOwner = (file.tableName === 'User' && file.tableId === user.id) ||
            (file.tableName === 'Company' && file.tableId === activeCompanyId)

        // For shared documents, the company manager counts as an owner
        if (!isOwner && file.tableName === 'CompanyDriverSetting' && activeCompanyId) {
            isOwner = file.allowedCompanyIds?.includes(activeCompanyId) || false
        }

        if (!isOwner && file.tableName === 'Vehicle') {
            const Vehicle = (await import('#models/vehicle')).default
            const vehicle = await Vehicle.find(file.tableId)
            if (vehicle) {
                isOwner = (vehicle.ownerType === 'User' && vehicle.ownerId === user.id) ||
                    (vehicle.ownerType === 'Company' && vehicle.ownerId === activeCompanyId)
            }
        }

        return isOwner
    }

    /**
     * Check if user can update file permissions (same as delete)
     */
    async canUserUpdateFile(user: User, fileId: string): Promise<boolean> {
        return await this.canUserDeleteFile(user, fileId)
    }

    /**
     * List files with access control filtering
     */
    async listFilesWithAccess(user: User | null, tableName: string, tableId: string, tableColumn?: string) {
        const files = await this.getFilesFor(tableName, tableId, tableColumn)

        const accessibleFiles = []
        for (const file of files) {
            const canAccess = await this.canUserAccessFile(file, user)
            if (canAccess) {
                accessibleFiles.push(file)
            }
        }

        return accessibleFiles
    }

    /**
     * Update file permissions
     */
    async updatePermissions(
        fileId: string,
        permissions: {
            isPublic?: boolean
            allowedUserIds?: string[]
            allowedCompanyIds?: string[]
        }
    ): Promise<File> {
        const file = await File.findOrFail(fileId)

        if (permissions.isPublic !== undefined) {
            file.isPublic = permissions.isPublic
        }
        if (permissions.allowedUserIds !== undefined) {
            file.allowedUserIds = permissions.allowedUserIds
        }
        if (permissions.allowedCompanyIds !== undefined) {
            file.allowedCompanyIds = permissions.allowedCompanyIds
        }

        await file.save()
        return file
    }

    /**
     * Add user to allowedUserIds
     */
    async addAllowedUser(fileId: string, userId: string): Promise<File> {
        const file = await File.findOrFail(fileId)
        const users = file.allowedUserIds || []
        if (!users.includes(userId)) {
            users.push(userId)
            file.allowedUserIds = users
            await file.save()
        }
        return file
    }

    /**
     * Remove user from allowedUserIds
     */
    async removeAllowedUser(fileId: string, userId: string): Promise<File> {
        const file = await File.findOrFail(fileId)
        file.allowedUserIds = (file.allowedUserIds || []).filter(id => id !== userId)
        await file.save()
        return file
    }

    /**
     * Add company to allowedCompanyIds
     */
    async addAllowedCompany(fileId: string, companyId: string): Promise<File> {
        const file = await File.findOrFail(fileId)
        const companies = file.allowedCompanyIds || []
        if (!companies.includes(companyId)) {
            companies.push(companyId)
            file.allowedCompanyIds = companies
            await file.save()
        }
        return file
    }

    /**
     * Remove company from allowedCompanyIds
     */
    async removeAllowedCompany(fileId: string, companyId: string): Promise<File> {
        const file = await File.findOrFail(fileId)
        file.allowedCompanyIds = (file.allowedCompanyIds || []).filter(id => id !== companyId)
        await file.save()
        return file
    }
}

export default new FileService()
