import { MultipartFile } from '@adonisjs/core/bodyparser'
import File, { type FileCategory } from '#models/file'
import FileData, { type FileConfig, type AccessList } from '#models/file_data'
import fs from 'node:fs/promises'
import path from 'node:path'
import { generateId } from '../utils/id_generator.js'
import { HttpContext } from '@adonisjs/core/http'
import encryption from '@adonisjs/core/services/encryption'
import User from '#models/user'

export interface SyncOptions {
    column: string
    isPublic?: boolean
    config?: FileConfig
}

export interface ShareOptions {
    read?: Partial<AccessList>
    write?: Partial<AccessList>
}

export default class FileManager {
    private uploadDir = process.env.UPLOAD_DIR || './uploads'
    private entity: any
    private tableName: string

    constructor(entity: any, tableName: string) {
        this.entity = entity
        this.tableName = tableName
    }

    /**
     * Get or create FileData for a column
     */
    async getFileData(column: string, ownerId: string, config?: FileConfig): Promise<FileData> {
        return FileData.getOrCreate(
            this.tableName,
            column,
            String(this.entity.id),
            ownerId,
            config
        )
    }

    /**
     * Check if user can write to a column (includes companyDriverIds and dynamicQuery)
     */
    async canWrite(column: string, user: User): Promise<boolean> {
        const fileData = await FileData.query()
            .where('tableName', this.tableName)
            .where('tableColumn', column)
            .where('tableId', String(this.entity.id))
            .first()

        if (!fileData) {
            // No FileData = owner is entity owner or creator
            return true
        }

        const userCompanyId = user.currentCompanyManaged || user.companyId
        return fileData.canWriteAsync(user.id, userCompanyId)
    }

    /**
     * Check if user can read files from a column (includes companyDriverIds and dynamicQuery)
     */
    async canRead(column: string, user: User | null, isPublic?: boolean): Promise<boolean> {
        if (isPublic) return true
        if (!user) return false

        const fileData = await FileData.query()
            .where('tableName', this.tableName)
            .where('tableColumn', column)
            .where('tableId', String(this.entity.id))
            .first()

        if (!fileData) return false

        const userCompanyId = user.currentCompanyManaged || user.companyId
        return fileData.canReadAsync(user.id, userCompanyId)
    }

    /**
     * Share files with users or companies
     */
    async share(column: string, options: ShareOptions): Promise<FileData> {
        const fileData = await FileData.query()
            .where('tableName', this.tableName)
            .where('tableColumn', column)
            .where('tableId', String(this.entity.id))
            .firstOrFail()

        // Update read access
        if (options.read?.userIds) {
            const existing = fileData.readAccess.userIds
            fileData.readAccess = {
                ...fileData.readAccess,
                userIds: [...new Set([...existing, ...options.read.userIds])]
            }
        }
        if (options.read?.companyIds) {
            const existing = fileData.readAccess.companyIds
            fileData.readAccess = {
                ...fileData.readAccess,
                companyIds: [...new Set([...existing, ...options.read.companyIds])]
            }
        }

        // Update write access
        if (options.write?.userIds) {
            const existing = fileData.writeAccess.userIds
            fileData.writeAccess = {
                ...fileData.writeAccess,
                userIds: [...new Set([...existing, ...options.write.userIds])]
            }
        }
        if (options.write?.companyIds) {
            const existing = fileData.writeAccess.companyIds
            fileData.writeAccess = {
                ...fileData.writeAccess,
                companyIds: [...new Set([...existing, ...options.write.companyIds])]
            }
        }

        await fileData.save()
        return fileData
    }

    /**
     * Revoke access from users or companies
     */
    async revoke(column: string, options: ShareOptions): Promise<FileData> {
        const fileData = await FileData.query()
            .where('tableName', this.tableName)
            .where('tableColumn', column)
            .where('tableId', String(this.entity.id))
            .firstOrFail()

        if (options.read?.userIds) {
            fileData.readAccess = {
                ...fileData.readAccess,
                userIds: fileData.readAccess.userIds.filter(id => !options.read!.userIds!.includes(id))
            }
        }
        if (options.read?.companyIds) {
            fileData.readAccess = {
                ...fileData.readAccess,
                companyIds: fileData.readAccess.companyIds.filter(id => !options.read!.companyIds!.includes(id))
            }
        }
        if (options.write?.userIds) {
            fileData.writeAccess = {
                ...fileData.writeAccess,
                userIds: fileData.writeAccess.userIds.filter(id => !options.write!.userIds!.includes(id))
            }
        }
        if (options.write?.companyIds) {
            fileData.writeAccess = {
                ...fileData.writeAccess,
                companyIds: fileData.writeAccess.companyIds.filter(id => !options.write!.companyIds!.includes(id))
            }
        }

        await fileData.save()
        return fileData
    }

    /**
     * Sync files for a column (upload/delete/update)
     */
    async sync(ctx: HttpContext, options: SyncOptions) {
        const { request, auth } = ctx
        const { column } = options
        const user = auth.user!

        // Ensure FileData exists
        await this.getFileData(column, user.id, options.config)

        // 1. Handle Targeted Deletions
        const rawDeleteIds = request.input(`${column}_delete`)
        if (rawDeleteIds) {
            const toDeleteIds = Array.isArray(rawDeleteIds) ? rawDeleteIds : [rawDeleteIds]
            for (const id of toDeleteIds) {
                await this.deleteFile(id)
            }
        }

        // 2. Handle Atomic Replacement (Update ID)
        const updateId = request.input(`${column}_update_id`)
        if (updateId) {
            await this.deleteFile(updateId)
        }

        // 3. Handle Uploads 
        const multipleFiles = request.files(column)
        const singleFile = request.file(column)

        if (multipleFiles && Array.isArray(multipleFiles) && multipleFiles.length > 0) {
            await this.uploadFiles(multipleFiles, options, user.id)
        } else if (singleFile && singleFile.isValid) {
            await this.uploadFiles([singleFile], options, user.id)
        }
    }

    /**
     * Manually upload files for a specific column/owner
     */
    async uploadFiles(files: MultipartFile[], options: SyncOptions, ownerId: string) {
        await this.getFileData(options.column, ownerId, options.config)
        for (const file of files) {
            if (file.isValid) {
                await this.processUpload(file, options)
            }
        }
    }

    /**
     * Delete all files and FileData for entity
     */
    async deleteAll() {
        const files = await File.query()
            .where('tableName', this.tableName)
            .where('tableId', String(this.entity.id))

        for (const file of files) {
            await this.deleteFile(file.id)
        }

        // Delete all FileData for this entity
        await FileData.query()
            .where('tableName', this.tableName)
            .where('tableId', String(this.entity.id))
            .delete()

        // Remove directory
        const entityDir = path.join(this.uploadDir, this.tableName.toLowerCase(), String(this.entity.id))
        try {
            await fs.rm(entityDir, { recursive: true, force: true })
        } catch { }
    }

    /**
     * Clone a file using a hard link (Solution B - Deduplication)
     * Creates a new database record and a new filesystem path, 
     * but both point to the same physical data.
     */
    async cloneFileAsHardLink(sourceFile: File, targetColumn: string, options: { isEncrypted?: boolean } = {}) {
        const fileId = generateId('fil')
        const ext = path.extname(sourceFile.name)
        const fileName = `${targetColumn}_${this.tableName.toLowerCase()}_${this.entity.id}_${fileId}${ext}`

        const entityDir = path.join(this.uploadDir, this.tableName.toLowerCase(), String(this.entity.id))
        await fs.mkdir(entityDir, { recursive: true })

        const targetPath = path.join(entityDir, fileName)

        // Create the hard link
        await fs.link(sourceFile.path, targetPath)

        return File.create({
            id: fileId,
            path: targetPath,
            name: fileName,
            tableName: this.tableName,
            tableColumn: targetColumn,
            tableId: String(this.entity.id),
            mimeType: sourceFile.mimeType,
            size: sourceFile.size,
            isEncrypted: options.isEncrypted ?? sourceFile.isEncrypted,
            fileCategory: sourceFile.fileCategory,
            metadata: {
                ...sourceFile.metadata,
                clonedFrom: sourceFile.id,
                clonedAt: new Date().toISOString()
            }
        })
    }

    private async processUpload(file: MultipartFile, options: SyncOptions) {
        const fileId = generateId('fil')
        const ext = file.extname || 'bin'
        const fileName = `${options.column}_${this.tableName.toLowerCase()}_${this.entity.id}_${fileId}.${ext}`

        const entityDir = path.join(this.uploadDir, this.tableName.toLowerCase(), String(this.entity.id))
        await fs.mkdir(entityDir, { recursive: true })

        const filePath = path.join(entityDir, fileName)

        let content = await fs.readFile(file.tmpPath!)
        if (options.config?.encrypt) {
            content = Buffer.from(encryption.encrypt(content.toString('base64')))
        }

        await fs.writeFile(filePath, content)

        await File.create({
            id: fileId,
            path: filePath,
            name: fileName,
            tableName: this.tableName,
            tableColumn: options.column,
            tableId: String(this.entity.id),
            mimeType: `${file.type}/${file.subtype}`,
            size: file.size,
            isEncrypted: options.config?.encrypt || false,
            fileCategory: this.getCategory(`${file.type}/${file.subtype}`),
            metadata: {}
        })
    }

    private async deleteFile(fileId: string) {
        const file = await File.find(fileId)
        if (file) {
            try {
                // unlink will remove this path. 
                // If there are other hard links, the bytes stay on disk.
                await fs.unlink(file.path)
            } catch { }
            await file.delete()
        }
    }

    private getCategory(mime: string): FileCategory {
        if (mime.startsWith('image/')) return 'IMAGE'
        if (mime.startsWith('video/')) return 'VIDEO'
        if (mime.startsWith('application/pdf')) return 'DOCS'
        if (mime.includes('json')) return 'JSON'
        return 'OTHER'
    }

    static async getPathsFor(tableName: string, tableId: string, column: string): Promise<string[]> {
        const files = await File.query()
            .where('tableName', tableName)
            .where('tableId', tableId)
            .where('tableColumn', column)
            .orderBy('createdAt', 'asc')

        return files.map(f => f.name)
    }

    /**
     * Static permission check for StorageController
     */
    static async checkFileAccess(file: File, user: User | null): Promise<boolean> {
        // Admin bypass
        if (user?.isAdmin) return true

        // Check FileData permissions
        const fileData = await FileData.query()
            .where('tableName', file.tableName)
            .where('tableColumn', file.tableColumn)
            .where('tableId', file.tableId)
            .first()

        // If no FileData, access is restricted to system
        if (!fileData) return false

        // If FileData exists but no user, check public access (if implemented in config)
        if (!user) {
            // Placeholder: currently no columns are truly public without token
            return false
        }

        const userCompanyId = user.currentCompanyManaged || user.companyId
        return fileData.canRead(user.id, userCompanyId)
    }

    /**
     * Generate a temporary download token for a file
     */
    static async generateDownloadToken(filename: string, user: User): Promise<string> {
        const file = await File.query().where('name', filename).first()
        if (!file) {
            throw new Error('File not found')
        }

        const hasAccess = await this.checkFileAccess(file, user)
        if (!hasAccess) {
            throw new Error('Access denied')
        }

        // Generate token valid for 5 minutes
        return encryption.encrypt({
            filename,
            userId: user.id,
            expiresAt: Date.now() + 5 * 60 * 1000
        })
    }

    /**
     * Verify a temporary download token
     */
    static verifyDownloadToken(token: string, filename: string): boolean {
        try {
            const data = encryption.decrypt<{ filename: string, userId: string, expiresAt: number }>(token)
            if (!data) return false

            // Check if token is for this file and not expired
            return data.filename === filename && data.expiresAt > Date.now()
        } catch {
            return false
        }
    }
}
