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

    test('Scenario: Full Shadow Lifecycle Verification', async ({ client, assert }) => {
        // --- PREPARATION: Create a balanced order (Pickup -> Delivery) ---
        let response = await client.post('/v1/orders/initiate')
            .loginAs(clientUser)
            .json({ ref_id: 'SHADOW-TEST-001', assignment_mode: 'GLOBAL' })
        response.assertStatus(201)
        const orderId = response.body().order.id

        // Fetch to get the default step created during initiation
        const initFetch = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const step1Id = initFetch.body().steps[0].id

        // Stop 1: Pickup (in existing Step 1)
        let stop1Res = await client.post(`/v1/steps/${step1Id}/stops`)
            .loginAs(clientUser)
            .json({
                address: { street: 'Pickup point', city: 'Abidjan', lat: 5.35, lng: -4.00 },
                client: { name: 'Sender', phone: '+225001' },
                actions: [
                    {
                        type: 'pickup',
                        quantity: 5,
                        transit_item: { name: 'Item Alpha', packaging_type: 'box' }
                    }
                ]
            })
        stop1Res.assertStatus(201)

        // Fetch to get TransitItem ID
        const midOrder = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const transitItemId = midOrder.body().transitItems[0].id

        // Step 2: Delivery
        let step2Res = await client.post(`/v1/orders/${orderId}/steps`)
            .loginAs(clientUser)
            .json({ sequence: 20 })
        step2Res.assertStatus(201)
        const step2Id = step2Res.body().step.id

        let stop2Res = await client.post(`/v1/steps/${step2Id}/stops`)
            .loginAs(clientUser)
            .json({
                address: { street: 'Delivery point', city: 'Abidjan', lat: 5.30, lng: -3.95 },
                client: { name: 'Receiver', phone: '+225002' },
                actions: [
                    {
                        type: 'delivery',
                        quantity: 5,
                        transit_item_id: transitItemId
                    }
                ]
            })
        stop2Res.assertStatus(201)

        // --- SUBMIT ORDER ---
        let submitRes = await client.post(`/v1/orders/${orderId}/submit`)
            .loginAs(clientUser)
        if (submitRes.status() !== 200) {
            console.error('Submit failed:', JSON.stringify(submitRes.body(), null, 2))
        }
        submitRes.assertStatus(200)

        // --- FETCH IDs for Testing ---
        const finalInitOrder = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const originalStop = finalInitOrder.body().steps.find((s: any) => s.id === step1Id).stops[0]
        const originalStopId = originalStop.id
        const originalActionId = originalStop.actions[0].id

        // --- 1. SHADOW CREATION ---
        let patchStopRes = await client.patch(`/v1/stops/${originalStopId}`)
            .loginAs(clientUser)
            .json({
                address: { street: 'Avenue des Lumières' }
            })
        patchStopRes.assertStatus(200)

        const shadowStopId = patchStopRes.body().stop.id
        assert.notEqual(shadowStopId, originalStopId)
        assert.equal(patchStopRes.body().stop.originalId, originalStopId)
        assert.isTrue(patchStopRes.body().stop.isPendingChange)

        // --- 2. IDEMPOTENCE ---
        let secondPatchRes = await client.patch(`/v1/stops/${originalStopId}`)
            .loginAs(clientUser)
            .json({
                address: { street: 'Boulevard de la Paix' }
            })
        secondPatchRes.assertStatus(200)
        assert.equal(secondPatchRes.body().stop.id, shadowStopId)

        // --- 3. HIERARCHICAL CLONING ---
        let patchActionRes = await client.patch(`/v1/actions/${originalActionId}`)
            .loginAs(clientUser)
            .json({ quantity: 10 })
        patchActionRes.assertStatus(200)

        const shadowActionId = patchActionRes.body().action.id
        assert.notEqual(shadowActionId, originalActionId)
        assert.equal(patchActionRes.body().action.stopId, shadowStopId)

        // --- 4. TRANSPARENT FETCHING ---
        let getOrderRes = await client.get(`/v1/orders/${orderId}`)
            .loginAs(clientUser)
        getOrderRes.assertStatus(200)

        const orderBody = getOrderRes.body()
        const step1 = orderBody.steps.find((s: any) => s.id === step1Id)
        assert.lengthOf(step1.stops, 1)
        assert.equal(step1.stops[0].id, shadowStopId)
        assert.lengthOf(step1.stops[0].actions, 1)
        assert.equal(step1.stops[0].actions[0].id, shadowActionId)

        // --- 5. JSON DEEP MERGE ---
        let mergePatchRes = await client.patch(`/v1/stops/${shadowStopId}`)
            .loginAs(clientUser)
            .json({
                client: { email: 'new@shadow.com' }
            })
        mergePatchRes.assertStatus(200)

        const updatedClient = mergePatchRes.body().stop.client
        assert.equal(updatedClient.email, 'new@shadow.com')
        assert.equal(updatedClient.name, 'Sender', 'Name should be preserved')

        // --- 6. PUSH-UPDATES MERGE & CLEANUP ---
        // Shadow the delivery action too to maintain balance (Pickup 10 / Delivery 10)
        const deliveryActionId = finalInitOrder.body().steps.find((s: any) => s.id === step2Id).stops[0].actions[0].id
        await client.patch(`/v1/actions/${deliveryActionId}`)
            .loginAs(clientUser)
            .json({ quantity: 10 })

        let pushRes = await client.post(`/v1/orders/${orderId}/push-updates`)
            .loginAs(clientUser)
        if (pushRes.status() !== 200) {
            console.error('Push failed:', JSON.stringify(pushRes.body(), null, 2))
        }
        pushRes.assertStatus(200)

        let finalOrderRes = await client.get(`/v1/orders/${orderId}`)
            .loginAs(clientUser)
        finalOrderRes.assertStatus(200)

        const finalStep1 = finalOrderRes.body().steps.find((s: any) => s.id === step1Id)
        const finalStops = finalStep1.stops
        const finalActions = finalStops[0].actions

        assert.equal(finalStops[0].id, originalStopId)
        assert.isFalse(!!finalStops[0].isPendingChange)
        assert.equal(finalStops[0].address.street, 'Boulevard de la Paix')
        assert.equal(finalStops[0].client.email, 'new@shadow.com')
        assert.equal(finalActions[0].id, originalActionId)
        assert.equal(finalActions[0].quantity, 10)

        // --- 7. RESILIENCE ---
        let deadShadowRes = await client.patch(`/v1/stops/${shadowStopId}`)
            .loginAs(clientUser)
            .json({ street: 'Ghosts' })
        deadShadowRes.assertStatus(404)
    })
})
