/*
/home/opus/Projects/Sublymus/Delivery/delivery-api/tests/functional/order_progressive.md
*/

import { test } from '@japa/runner'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import { generateId } from '../../app/utils/id_generator.js'

test.group('Order Progressive Creation (Intern Simulation)', (group) => {
    let clientUser: User

    group.each.setup(async () => {
        await db.beginGlobalTransaction()
        clientUser = await User.create({
            email: `intern-${generateId('tst')}@example.com`,
            password: 'password123',
            fullName: 'Stagiaire Alpha',
            isActive: true
        })
        return () => db.rollbackGlobalTransaction()
    })

    test('Scenario: Le Grand Tour de l\'Aube', async ({ client, assert }) => {
        // Utils for robust body traversal
        const findItem = (body: any, name: string) => {
            const items = body.transitItems || body.transit_items || []
            return items.find((i: any) => i.name === name || i.name.includes(name))
        }

        const assertCreated = (res: any, name: string) => {
            if (res.status() !== 201) {
                console.error(`Failed to create ${name}:`, JSON.stringify(res.body(), null, 2))
            }
            res.assertStatus(201)
        }

        // --- PHASE 1: Initiation Maladroite ---
        let response = await client.post('/v1/orders/initiate')
            .loginAs(clientUser)
            .json({ ref_id: 'PROGRESSIVE-TOUR-001', assignment_mode: 'GLOBAL' })

        response.assertStatus(201)
        const orderId = response.body().order.id

        // Create Step 1
        let step1Res = await client.post(`/v1/orders/${orderId}/steps`)
            .loginAs(clientUser)
            .json({ sequence: 10 }) // Use larger step increments to avoid collision if any
        assertCreated(step1Res, 'Step 1')
        const step1Id = step1Res.body().entity.id

        // S1 (Pickup) : IT1, IT2
        let s1 = await client.post(`/v1/steps/${step1Id}/stops`)
            .loginAs(clientUser)
            .json({
                address: { street: 'Avenue Marchand Plateau', city: 'Abidjan', lat: 5.32, lng: -4.01, call: 'BOUBOU-123' },
                client: { name: 'Hub Alpha', email: 'hub@alpha.ci' },
                actions: [
                    { type: 'pickup', quantity: 1, transit_item: { name: 'IT1', packaging_type: 'box' } },
                    { type: 'pickup', quantity: 100, transit_item: { name: 'IT2', packaging_type: 'fluid', dimensions: { volume_l: 100 } } }
                ]
            })
        assertCreated(s1, 'Step 1 - Stop 1')

        // S2 (Pickup) : IT3(+5)
        let s2 = await client.post(`/v1/steps/${step1Id}/stops`)
            .loginAs(clientUser)
            .json({
                address: { street: 'Rue des Brasseurs Zone 4', city: 'Abidjan', lat: 5.29, lng: -3.99 },
                actions: [{ type: 'pickup', quantity: 5, transit_item: { name: 'IT3', packaging_type: 'box' } }]
            })
        assertCreated(s2, 'Step 1 - Stop 2')

        // S3 (Service)
        let s3 = await client.post(`/v1/steps/${step1Id}/stops`)
            .loginAs(clientUser)
            .json({
                address: { street: 'Garage de la Mairie', city: 'Abidjan', lat: 5.31, lng: -4.00 },
                actions: [{ type: 'service', quantity: 0 }]
            })
        assertCreated(s3, 'Step 1 - Stop 3')

        // S4 (Pickup) : IT4(+10)
        let s4 = await client.post(`/v1/steps/${step1Id}/stops`)
            .loginAs(clientUser)
            .json({
                address: { street: 'Boulevard de la Poste', city: 'Abidjan', lat: 5.33, lng: -4.02 },
                actions: [{ type: 'pickup', quantity: 10, transit_item: { name: 'IT4', packaging_type: 'box' } }]
            })
        assertCreated(s4, 'Step 1 - Stop 4')

        // --- FETCH IDs ---
        const fullOrder = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const it1 = findItem(fullOrder.body(), 'IT1')
        const it2 = findItem(fullOrder.body(), 'IT2')
        const it3 = findItem(fullOrder.body(), 'IT3')
        const it4 = findItem(fullOrder.body(), 'IT4')

        // --- PHASE 3: Step 2 ---
        let step2Res = await client.post(`/v1/orders/${orderId}/steps`)
            .loginAs(clientUser)
            .json({ sequence: 20 })
        assertCreated(step2Res, 'Step 2')
        const step2Id = step2Res.body().entity.id

        // S1 : IT2(-50)
        let s2s1 = await client.post(`/v1/steps/${step2Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Riviera Palmeraie', city: 'Abidjan', lat: 5.36, lng: -3.97 },
            actions: [{ type: 'delivery', quantity: 50, transit_item_id: it2.id }]
        })
        assertCreated(s2s1, 'Step 2 - Stop 1')

        // S2 : IT4(-2)
        let s2s2 = await client.post(`/v1/steps/${step2Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Zone Portuaire Docker', city: 'Abidjan', lat: 5.32, lng: -4.02 },
            actions: [{ type: 'delivery', quantity: 2, transit_item_id: it4.id }]
        })
        assertCreated(s2s2, 'Step 2 - Stop 2')

        // S3 : IT1(-1)
        let s2s3 = await client.post(`/v1/steps/${step2Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Cocody Cité des Arts', city: 'Abidjan', lat: 5.35, lng: -3.99 },
            actions: [{ type: 'delivery', quantity: 1, transit_item_id: it1.id }]
        })
        assertCreated(s2s3, 'Step 2 - Stop 3')

        // S4 : IT1_New(+1)
        let s2s4 = await client.post(`/v1/steps/${step2Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Bingerville Cité SIR', city: 'Abidjan', lat: 5.36, lng: -3.89 },
            actions: [{ type: 'pickup', quantity: 1, transit_item: { name: 'IT1_New', packaging_type: 'box' } }]
        })
        assertCreated(s2s4, 'Step 2 - Stop 4')

        // Fetch IT1_New ID
        const orderAfterPhase3 = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const it1New = findItem(orderAfterPhase3.body(), 'IT1_New')
        const it1NewId = it1New?.id
        assert.exists(it1NewId, 'IT1_New should have been created inline')

        // --- PHASE 4: Step 3 ---
        let it5Res = await client.post(`/v1/orders/${orderId}/items`).loginAs(clientUser).json({ name: 'IT5', packaging_type: 'box' })
        assertCreated(it5Res, 'IT5 Creation')
        const it5Id = it5Res.body().entity.id

        let step3Res = await client.post(`/v1/orders/${orderId}/steps`).loginAs(clientUser).json({ sequence: 30 })
        assertCreated(step3Res, 'Step 3')
        const step3Id = step3Res.body().entity.id

        // S1 : IT5(+2), IT2(+200)
        let s3s1 = await client.post(`/v1/steps/${step3Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Zone Industrielle Yopougon', city: 'Abidjan', lat: 5.34, lng: -4.07 },
            actions: [
                { type: 'pickup', quantity: 2, transit_item_id: it5Id },
                { type: 'pickup', quantity: 200, transit_item_id: it2.id }
            ]
        })
        assertCreated(s3s1, 'Step 3 - Stop 1')

        // S2 : Sv(0), IT5(-2)
        let s3s2 = await client.post(`/v1/steps/${step3Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Usine de Montage', city: 'Abidjan', lat: 5.35, lng: -4.08 },
            actions: [{ type: 'service', quantity: 0 }, { type: 'delivery', quantity: 2, transit_item_id: it5Id }]
        })
        assertCreated(s3s2, 'Step 3 - Stop 2')

        // S3 : IT3(-2)
        let s3s3 = await client.post(`/v1/steps/${step3Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Supermarché Sococe', city: 'Abidjan', lat: 5.37, lng: -3.99 },
            actions: [{ type: 'delivery', quantity: 2, transit_item_id: it3.id }]
        })
        assertCreated(s3s3, 'Step 3 - Stop 3')

        // S4 : IT4(-3)
        let s3s4 = await client.post(`/v1/steps/${step3Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Mairie de Treichville', city: 'Abidjan', lat: 5.31, lng: -4.01 },
            actions: [{ type: 'delivery', quantity: 3, transit_item_id: it4.id }]
        })
        assertCreated(s3s4, 'Step 3 - Stop 4')

        // --- PHASE 5: Step 4 ---
        let step4Res = await client.post(`/v1/orders/${orderId}/steps`).loginAs(clientUser).json({ sequence: 40, linked: true })
        assertCreated(step4Res, 'Step 4')
        const step4Id = step4Res.body().entity.id

        let s4s1 = await client.post(`/v1/steps/${step4Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Banque Centrale BCEAO', city: 'Abidjan', lat: 5.32, lng: -4.02 },
            actions: [{ type: 'delivery', quantity: 5, transit_item_id: it4.id }]
        })
        assertCreated(s4s1, 'Step 4 - Stop 1')

        let s4s2 = await client.post(`/v1/steps/${step4Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Immeuble CCIA Plateau', city: 'Abidjan', lat: 5.32, lng: -4.01 },
            actions: [{ type: 'delivery', quantity: 100, transit_item_id: it2.id }]
        })
        assertCreated(s4s2, 'Step 4 - Stop 2')

        let s4s3 = await client.post(`/v1/steps/${step4Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Hôtel Ivoire Cocody', city: 'Abidjan', lat: 5.34, lng: -3.98 },
            actions: [{ type: 'pickup', quantity: 2, transit_item_id: it3.id }]
        })
        assertCreated(s4s3, 'Step 4 - Stop 3')

        let s4s4 = await client.post(`/v1/steps/${step4Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Centre de Tri Secondaire', city: 'Abidjan', lat: 5.33, lng: -4.03 },
            actions: [{ type: 'delivery', quantity: 1, transit_item_id: it1NewId }]
        })
        assertCreated(s4s4, 'Step 4 - Stop 4')

        // --- PHASE 6: Step 5 ---
        let step5Res = await client.post(`/v1/orders/${orderId}/steps`).loginAs(clientUser).json({ sequence: 50 })
        assertCreated(step5Res, 'Step 5')
        const step5Id = step5Res.body().entity.id

        let s5s1 = await client.post(`/v1/steps/${step5Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Entrepôt Logistique Sud', city: 'Abidjan', lat: 5.25, lng: -4.00 },
            actions: [{ type: 'delivery', quantity: 5, transit_item_id: it3.id }]
        })
        assertCreated(s5s1, 'Step 5 - Stop 1')

        let s5s2 = await client.post(`/v1/steps/${step5Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Station de Recharge', city: 'Abidjan', lat: 5.24, lng: -4.01 },
            actions: [{ type: 'delivery', quantity: 150, transit_item_id: it2.id }]
        })
        assertCreated(s5s2, 'Step 5 - Stop 2')

        let s5s3 = await client.post(`/v1/steps/${step5Id}/stops`).loginAs(clientUser).json({
            address: { street: 'Centre Depot Sublymus', city: 'Abidjan', lat: 5.23, lng: -4.02 },
            actions: [{ type: 'service', quantity: 0 }]
        })
        assertCreated(s5s3, 'Step 5 - Stop 3')

        // --- SUBMIT ---
        let submitRes = await client.post(`/v1/orders/${orderId}/submit`).loginAs(clientUser).json({})
        if (submitRes.status() !== 200) {
            console.error('Submission failed:', JSON.stringify(submitRes.body(), null, 2))
        }
        submitRes.assertStatus(200)

        const finalFullOrder = await client.get(`/v1/orders/${orderId}`).loginAs(clientUser)
        const finalEntity = finalFullOrder.body()
        const stop1 = finalEntity.steps[0].stops[0]

        assert.equal(stop1.address.call, 'BOUBOU-123')
        assert.equal(stop1.client.name, 'Hub Alpha')
    })
})
