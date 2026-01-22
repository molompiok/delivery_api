import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const DocumentController = () => import('#controllers/document_controller')

router.group(() => {
    // Document Management
    router.get('/documents/:tableName/:tableId', [DocumentController, 'listDocuments'])
    router.get('/documents/:docId', [DocumentController, 'getDocument'])
    router.patch('/documents/:docId/submit', [DocumentController, 'submitFile'])
    router.post('/documents/:docId/validate', [DocumentController, 'validateDocument'])
    router.post('/documents/:docId/expiry', [DocumentController, 'setExpiry'])

    // Admin Routes
    router.post('/admin/documents/bulk-add', [DocumentController, 'bulkAddDocument'])
    router.post('/admin/documents/bulk-remove', [DocumentController, 'bulkRemoveDocument'])
    router.post('/admin/drivers/:driverId/documents', [DocumentController, 'addDocumentToDriver'])
    router.delete('/admin/documents/:docId', [DocumentController, 'removeDocumentFromDriver'])
})
    .prefix('/v1')
    .use(middleware.auth())
