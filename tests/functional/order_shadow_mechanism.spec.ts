import { test } from '@japa/runner'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import { generateId } from '../../app/utils/id_generator.js'

test.group('Order Shadow Mechanism', (group) => {
    let clientUser: User

    group.each.setup(async () => {
        await db.beginGlobalTransaction()
        clientUser = await User.create({
            email: `tester-${generateId('tst')}@example.com`,
            password: 'password123',
            fullName: 'Shadow Tester',
            isActive: true
        })
        return () => db.rollbackGlobalTransaction()
    })

    test('Scenario: Strict Anchoring & Shallow Cloning', async ({ client, assert }) => {
        // 1. Create Order
        let res = await client.post('/v1/orders/initiate').loginAs(clientUser).json({ ref_id: 'STRICT-001' })
        const orderId = res.body().order.id

        // Fetch Step 1
        res = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const step1Id = res.body().steps[0].id

        // Add Stop 1 (Original)
        res = await client.post(`/v1/steps/${step1Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Pickup point', lat: 5.35, lng: -4.00 },
            actions: [{ type: 'pickup', quantity: 5, transit_item: { name: 'Alpha' } }]
        })
        const stop1Id = res.body().stop.id

        // Submit to make it official
        await client.post(`/v1/orders/${orderId}/submit`).loginAs(clientUser)

        // --- TEST 1: Strict Action Anchoring ---
        // Shadow the Stop 1
        res = await client.patch(`/v1/stops/${stop1Id}`).loginAs(clientUser).json({ address: { street: 'New Address' } })
        const shadowStopId = res.body().stop.id
        assert.notEqual(shadowStopId, stop1Id)

        // Add a NEW action to the Shadow Stop
        res = await client.post(`/v1/stops/${shadowStopId}/actions`).loginAs(clientUser).json({
            type: 'pickup', quantity: 10, transit_item: { name: 'Beta' }
        })
        const newAction = res.body().action
        assert.equal(newAction.stopId, stop1Id, 'Action must be anchored to ORIGINAL Stop ID, not Shadow ID')

        // --- TEST 2: Virtual State Rendering ---
        res = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const virtualStops = res.body().steps[0].stops
        assert.lengthOf(virtualStops, 1)
        assert.equal(virtualStops[0].id, shadowStopId, 'Virtual view should show the shadow stop')
        assert.lengthOf(virtualStops[0].actions, 2, 'Virtual view should collect actions from original even if parent is shadowed')

        // --- TEST 3: Push Updates ---
        await client.post(`/v1/orders/${orderId}/push-updates`).loginAs(clientUser)
        res = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const finalStop = res.body().steps[0].stops[0]
        assert.equal(finalStop.id, stop1Id, 'After push, we are back to original ID')
        assert.equal(finalStop.address_text, 'New Address')
        assert.lengthOf(finalStop.actions, 2)
    })

    test('Scenario: Transit Item Shadowing (Weight Modification)', async ({ client, assert }) => {
        // 1. Setup Order with Item
        let res = await client.post('/v1/orders/initiate').loginAs(clientUser)
        const orderId = res.body().order.id
        const stepId = res.body().order.steps[0].id

        res = await client.post(`/v1/steps/${stepId}/stops`).loginAs(clientUser).json({
            address: { street: 'A', lat: 1, lng: 1 },
            actions: [{ type: 'pickup', quantity: 1, transit_item: { name: 'Anvil', weight: 5000 } }]
        })
        await client.post(`/v1/orders/${orderId}/submit`).loginAs(clientUser)

        const initFetch = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const originalItem = initFetch.body().transit_items[0]
        const originalItemId = originalItem.id

        // 2. Patch the item (Create Shadow)
        res = await client.patch(`/v1/orders/${orderId}/items/${originalItemId}`).loginAs(clientUser).json({
            weight: 10000,
            name: 'Heavy Anvil'
        })
        res.assertStatus(200)
        const shadowItemId = res.body().item.id
        assert.notEqual(shadowItemId, originalItemId)
        assert.equal(res.body().item.originalId, originalItemId)

        // 3. Verify Virtual State
        res = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        assert.equal(res.body().transit_items[0].id, shadowItemId, 'Virtual view must show shadow item')
        assert.equal(res.body().transit_items[0].weight, 10000)

        // 4. Push and Verify Merge
        await client.post(`/v1/orders/${orderId}/push-updates`).loginAs(clientUser)
        res = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const finalItem = res.body().transit_items[0]
        assert.equal(finalItem.id, originalItemId, 'Back to original ID after merge')
        assert.equal(finalItem.weight, 10000)
        assert.equal(finalItem.name, 'Heavy Anvil')
    })

    test('Scenario: Cleanup of Orphaned Transit Items', async ({ client, assert }) => {
        // 1. Create Item linked to 2 actions
        const initRes = await client.post('/v1/orders/initiate').loginAs(clientUser)
        const orderId = initRes.body().order.id
        const stepId = initRes.body().order.steps[0].id

        await client.post(`/v1/steps/${stepId}/stops`).loginAs(clientUser).json({
            address: { street: 'A', lat: 1, lng: 1 },
            actions: [{ type: 'pickup', quantity: 1, transit_item: { name: 'Ghost Item' } }]
        })
        await client.post(`/v1/orders/${orderId}/submit`).loginAs(clientUser)

        const fetch1 = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const actionId = fetch1.body().steps[0].stops[0].actions[0].id
        const itemId = fetch1.body().transit_items[0].id

        // 2. Delete the only action linked to it
        await client.delete(`/v1/actions/${actionId}`).loginAs(clientUser)

        // Virtual view should still have item (orphans only cleaned at push)
        const midFetch = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        assert.lengthOf(midFetch.body().transit_items, 1)

        // 3. Push and Verify Item Deletion
        await client.post(`/v1/orders/${orderId}/push-updates`).loginAs(clientUser)
        const finalFetch = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        assert.lengthOf(finalFetch.body().transit_items, 0, 'Item should be culled as it has no active actions')
    })

    test('Scenario: Revert Mechanism for Shadow Items', async ({ client, assert }) => {
        const initRes = await client.post('/v1/orders/initiate').loginAs(clientUser)
        const orderId = initRes.body().order.id
        const stepId = initRes.body().order.steps[0].id

        await client.post(`/v1/steps/${stepId}/stops`).loginAs(clientUser).json({
            address: { street: 'A', lat: 1, lng: 1 },
            actions: [{ type: 'pickup', quantity: 1, transit_item: { name: 'Revert Me' } }]
        })
        await client.post(`/v1/orders/${orderId}/submit`).loginAs(clientUser)

        const originalItemId = (await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)).body().transit_items[0].id

        // Modify item
        await client.patch(`/v1/orders/${orderId}/items/${originalItemId}`).loginAs(clientUser).json({ name: 'Changed' })

        // Revert
        await client.post(`/v1/orders/${orderId}/revert-updates`).loginAs(clientUser)

        const finalFetch = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        assert.equal(finalFetch.body().transit_items[0].name, 'Revert Me')
        assert.isTrue(!finalFetch.body().transit_items[0].is_pending_change)
    })
})
