/**
 * FILE_CREATION_FLOW.SPEC.TS - Functional Tests for Integrated File System
 * 
 * --- IDEMPOTENCY & STABILITY ---
 * - Uses `db.beginGlobalTransaction()` to wrap each test, ensuring a clean state after rollback.
 * - Files are saved to a dedicated test storage (if configured) or cleaned up via transactional DB logic.
 * 
 * --- DATA FLOW DETAILS ---
 * 1. Upload (store)
 *    - Sent: Multipart form-data with fields (name) and files (avatar, documents).
 *    - Received: JSON object of `FileTest` entity with computed virtual fields (URLs prefixed with `fs/`).
 * 
 * 2. Update (update)
 *    - Sent: `_update_id` to target a specific file for replacement, alongside new file content.
 *    - Received: Updated entity with the new file URL.
 * 
 * 3. Delete (destroy/update)
 *    - Sent: `_delete` field with an array of File IDs to remove.
 *    - Received: Entity with updated file list.
 * 
 * --- PROBLEMS & CORRECTIONS ---
 * - Problem: `authApiClient` was not initialized with `app`, causing `undefined container` errors.
 *   - Correction: Updated `tests/bootstrap.ts` to `authApiClient(app)`.
 * - Problem: `UserFactory` was missing in the project.
 *   - Correction: Switched to manual user creation using `User.create()`.
 * - Problem: `assert.stringContains` is not a Japa function.
 *   - Correction: Used `assert.include`.
 * - Problem: Signed URL access failed because `client.get().query()` is incorrect.
 *   - Correction: Used `client.get().qs({ token })`.
 * 
 * --- CRITICAL LOOK ---
 * - Atomic operations: The system ensures that if a DB record fails, files aren't "leaked" or vice-versa.
 * - Performance: Transactional tests are fast but don't delete physical files. 
 * - Scalability: The use of `table_name` and `table_id` in the `files` table allows any entity to have files without changing the schema.
 */

import { test } from '@japa/runner'
import fs from 'node:fs/promises'
import db from '@adonisjs/lucid/services/db'
import File from '#models/file'
import User from '#models/user'
import { generateId } from '../../app/utils/id_generator.js'

test.group('File Creation Flow', (group) => {
    let user: User
    let otherUser: User

    group.each.setup(async () => {
        // IDEMPOTENCY: Start a transaction for each test
        await db.beginGlobalTransaction()

        // Manual user creation since factories are missing
        user = await User.create({
            email: `test-${generateId('')}@example.com`,
            password: 'password123',
            fullName: 'Test User',
            isActive: true
        })

        otherUser = await User.create({
            email: `other-${generateId('')}@example.com`,
            password: 'password123',
            fullName: 'Other User',
            isActive: true
        })

        return () => db.rollbackGlobalTransaction()
    })

    test('creation: upload single file (avatar)', async ({ client, assert }) => {
        const response = await client
            .post('/v1/file-tests')
            .loginAs(user)
            .field('name', 'Test Entity')
            .file('avatar', Buffer.from('fake avatar content'), { filename: 'avatar.jpg' })

        response.assertStatus(201)

        const body = response.body()
        assert.include(body.avatar[0], 'fs/avatar_filetest_')

        const file = await File.query()
            .where('tableName', 'FileTest')
            .where('tableColumn', 'avatar')
            .where('tableId', body.id)
            .firstOrFail()

        assert.equal(file.name, body.avatar[0].replace('fs/', ''))
    })

    test('creation: upload multiple files (documents)', async ({ client, assert }) => {
        const response = await client
            .post('/v1/file-tests')
            .loginAs(user)
            .field('name', 'Test Multi')
            .file('documents', Buffer.from('doc 1'), { filename: 'doc1.pdf' })
            .file('documents', Buffer.from('doc 2'), { filename: 'doc2.pdf' })

        response.assertStatus(201)
        const body = response.body()

        assert.lengthOf(body.documents, 2)
        assert.include(body.documents[0], 'fs/documents_filetest_')
        assert.include(body.documents[1], 'fs/documents_filetest_')
    })

    test('update: replace file (avatar) using _update_id', async ({ client, assert }) => {
        const createRes = await client
            .post('/v1/file-tests')
            .loginAs(user)
            .field('name', 'Update Target')
            .file('avatar', Buffer.from('old content'), { filename: 'old.jpg' })

        const entityId = createRes.body().id
        const oldFileUrl = createRes.body().avatar[0]
        const oldFileId = oldFileUrl.split('_').pop()?.split('.')[0]

        const updateRes = await client
            .put(`/v1/file-tests/${entityId}`)
            .loginAs(user)
            .field('avatar_update_id', `fil_${oldFileId}`)
            .file('avatar', Buffer.from('new content'), { filename: 'new.jpg' })

        updateRes.assertStatus(200)

        const body = updateRes.body()
        assert.lengthOf(body.avatar, 1)
        assert.notEqual(body.avatar[0], oldFileUrl)

        const deletedFile = await File.find(`fil_${oldFileId}`)
        assert.notExists(deletedFile)
    })

    test('delete: remove specific file using _delete', async ({ client, assert }) => {
        const createRes = await client
            .post('/v1/file-tests')
            .loginAs(user)
            .field('name', 'Delete Target')
            .file('documents', Buffer.from('doc 1'), { filename: 'doc1.pdf' })
            .file('documents', Buffer.from('doc 2'), { filename: 'doc2.pdf' })

        const entityId = createRes.body().id
        const file1Url = createRes.body().documents[0]
        const file1Id = file1Url.split('_').pop()?.split('.')[0]
        const file2Url = createRes.body().documents[1]

        const deleteRes = await client
            .put(`/v1/file-tests/${entityId}`)
            .loginAs(user)
            .field('documents_delete', [`fil_${file1Id}`])

        deleteRes.assertStatus(200)

        assert.lengthOf(deleteRes.body().documents, 1)
        assert.equal(deleteRes.body().documents[0], file2Url)

        const deletedFile = await File.find(`fil_${file1Id}`)
        assert.notExists(deletedFile)
    })

    test('permissions: access control (restricted vs shared)', async ({ client, assert: _assert }) => {
        const createRes = await client
            .post('/v1/file-tests')
            .loginAs(user)
            .field('name', 'Permission Test')
            .file('documents', Buffer.from('private content'), { filename: 'private.pdf' })

        const entityId = createRes.body().id
        const filename = createRes.body().documents[0].replace('fs/', '')

        const accessRes1 = await client.get(`/fs/${filename}`).loginAs(otherUser)
        accessRes1.assertStatus(403)

        await client
            .post(`/v1/file-tests/${entityId}/share`)
            .loginAs(user)
            .json({
                column: 'documents',
                read_user_ids: [otherUser.id]
            })

        const accessRes2 = await client.get(`/fs/${filename}`).loginAs(otherUser)
        accessRes2.assertStatus(200)
    })

    test('token: access via signed temporary URL', async ({ client, assert: _assert }) => {
        const createRes = await client
            .post('/v1/file-tests')
            .loginAs(user)
            .field('name', 'Token Test')
            .file('documents', Buffer.from('token protected content'), { filename: 'token.pdf' })

        const filename = createRes.body().documents[0].replace('fs/', '')

        const tokenRes = await client.get(`/v1/fs/token/${filename}`).loginAs(user)
        tokenRes.assertStatus(200)
        const token = tokenRes.body().token

        const accessRes = await client.get(`/fs/${filename}`).qs({ token })
        accessRes.assertStatus(200)
    })

    test('encryption: verify AES encryption on disk', async ({ client, assert }) => {
        const createRes = await client
            .post('/v1/file-tests')
            .loginAs(user)
            .field('name', 'Encryption Test')
            .file('documents', Buffer.from('sensitive data content'), { filename: 'secret.pdf' })

        const filename = createRes.body().documents[0].replace('fs/', '')
        const file = await File.query().where('name', filename).firstOrFail()

        assert.equal(file.isEncrypted, true)

        const rawContent = await fs.readFile(file.path, 'utf-8')
        assert.notEqual(rawContent, 'sensitive data content')
    })
})
