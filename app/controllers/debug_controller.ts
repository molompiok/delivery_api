import type { HttpContext } from '@adonisjs/core/http'
import File from '#models/file'
import FileData from '#models/file_data'

export default class DebugController {
    async listFiles({ response }: HttpContext) {
        const files = await File.all()
        return response.ok(files)
    }

    async listFileData({ response }: HttpContext) {
        const data = await FileData.all()
        return response.ok(data)
    }
}
