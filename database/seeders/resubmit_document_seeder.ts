import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Document from '#models/document'

export default class ResubmitDocumentSeeder extends BaseSeeder {
    async run() {
        const docId = 'doc_sa5ulm1z0a5ek4xycb'

        const doc = await Document.findOrFail(docId)
        console.log(`📄 Document trouvé: ${doc.documentType}, status: ${doc.status}`)

        // Simuler la re-soumission
        doc.status = 'PENDING'
        doc.validationComment = null
        await doc.save()

        console.log(`✅ Document ${docId} remis en PENDING (simulant une re-soumission)`)
    }
}
