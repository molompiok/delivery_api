import { HttpContext } from '@adonisjs/core/http'
import File from '#models/file'
import FileManager from '#services/file_manager'
import fs from 'node:fs'
import path from 'node:path'
import encryption from '@adonisjs/core/services/encryption'

export default class StorageController {
    /**
     * Get a temporary download token for a file
     */
    async getToken({ params, auth, response }: HttpContext) {
        try {
            const user = auth.user!
            const filename = params.filename

            const token = await FileManager.generateDownloadToken(filename, user)
            return response.ok({ token })
        } catch (error) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Serve a file with permission checks
     */
    async serve({ params, response, auth, request }: HttpContext) {
        const filename = params.filename
        const token = request.input('token')

        // 1. Find the file record
        const file = await File.query().where('name', filename).first()
        if (!file) {
            return response.notFound({ message: 'File not found' })
        }

        // 2. Security Check
        let hasAccess = false

        // A. If token is provided, verify it
        if (token) {
            hasAccess = FileManager.verifyDownloadToken(token, filename)
        }

        // B. If no token or token invalid, check session/auth
        if (!hasAccess) {
            await auth.check()
            hasAccess = await FileManager.checkFileAccess(file, auth.user || null)
        }

        if (!hasAccess) {
            return response.forbidden({ message: 'Access denied' })
        }

        // 3. Serve the file
        if (!fs.existsSync(file.path)) {
            return response.notFound({ message: 'Physical file not found' })
        }

        // Handle Decryption if needed
        if (file.isEncrypted) {
            const content = fs.readFileSync(file.path, 'utf-8')
            const decrypted = encryption.decrypt<string>(content)
            if (decrypted) {
                const buffer = Buffer.from(decrypted, 'base64')
                return response
                    .header('Content-Type', file.mimeType || 'application/octet-stream')
                    .header('Content-Length', String(buffer.length))
                    .send(buffer)
            }
        }

        return response.download(path.resolve(file.path))
    }
}
