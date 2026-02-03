/**
 * ORDER_BULK_CREATION.SPEC.TS - Complex Logistics Logic Verification
 * 
 * --- SCENARIOS VERIFIED ---
 * 1. THE "GRAND TOUR" (Success): 
 *    - 5 Steps, 12 Stops.
 *    - Mixed Milk Run & Hub Transfer.
 *    - Actions: 6 Pickups, 6 Deliveries across 12 stops.
 *    - Items: items move through multiple stops and steps.
 * 
 * 2. SUBTLE SEQUENCE ERROR (Failure):
 *    - Trying to deliver an item in Step 2 that is only picked up in Step 4.
 *    - This tests the path-by-path viability logic in LogisticsService.
 * 
 * 3. QUANTITY IMBALANCE (Failure):
 *    - Picking up 10 units but only delivering 8.
 *    - This tests the final equilibrium check (Final balance must be 0).
 * 
 * 4. SCHEMA VALIDATION (Failure):
 *    - Missing mandatory fields to verify VineJS integration.
 * 
 * --- IDEMPOTENCY ---
 * - Global transactions wrap each test.
 * - Manual user creation for environmental stability.
 */

import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { generateId } from '../../app/utils/id_generator.js'

test.group('Order Bulk Creation (Complex Scenarios)', (group) => {
    let clientUser: User

    group.each.setup(async () => {
        await db.beginGlobalTransaction()
        clientUser = await User.create({
            email: `client-${generateId('tst')}@example.com`,
            password: 'password123',
            fullName: 'Logistics Client',
            isActive: true
        })
        return () => db.rollbackGlobalTransaction()
    })

    /**
     * Scenario:
     * Step 1: Plateau(+ItemA:1), Cocody(+ItemB:1)
     * Step 2: Marcory(+ItemD:1), Koumassi(-ItemD:1), Port-Bouet(Service)
     * Step 3: Hub(-ItemB:1)
     * Step 4: Hub(+ItemC:1), Treichville(+ItemA:1), Adjame(+ItemD:5)
     * Step 5: Bingerville(-ItemA:2), Yopougon(-ItemC:1), Abobo(-ItemD:5)
     */
    test('Case 1: The "Grand Tour" (Success - 5 Steps, 12 Stops)', async ({ client, assert }) => {
        const payload = {
            assignment_mode: 'GLOBAL',
            priority: 'HIGH',
            ref_id: 'GRAND-TOUR-001',
            transit_items: [
                { id: 'item_a', name: 'Item A (Long Trip)', weight_g: 1000 },
                { id: 'item_b', name: 'Item B (Hub Transfer Part 1)', weight_g: 500 },
                { id: 'item_c', name: 'Item C (Hub Transfer Part 2)', weight_g: 500 },
                { id: 'item_d', name: 'Item D (Quick Delivery)', weight_g: 200 }
            ],
            steps: [
                // STEP 1: Initial Pickups
                {
                    sequence: 1,
                    stops: [
                        {
                            address: { street: 'P1: Plateau, Abidjan', lat: 5.32, lng: -4.02 },
                            actions: [{ type: 'PICKUP', quantity: 1, transit_item_id: 'item_a' }]
                        },
                        {
                            address: { street: 'P2: Cocody, Abidjan', lat: 5.35, lng: -4.00 },
                            actions: [{ type: 'PICKUP', quantity: 1, transit_item_id: 'item_b' }]
                        }
                    ]
                },
                // STEP 2: Milk Run (Pickup + Delivery)
                {
                    sequence: 2,
                    stops: [
                        {
                            address: { street: 'P3: Marcory, Abidjan', lat: 5.30, lng: -3.98 },
                            actions: [{ type: 'PICKUP', quantity: 1, transit_item_id: 'item_d' }]
                        },
                        {
                            address: { street: 'D3: Koumassi, Abidjan', lat: 5.28, lng: -3.95 },
                            actions: [{ type: 'DELIVERY', quantity: 1, transit_item_id: 'item_d' }]
                        },
                        {
                            address: { street: 'P4: Port-Bouët, Abidjan', lat: 5.25, lng: -3.93 },
                            actions: [{ type: 'SERVICE', metadata: { note: 'Check temp' } }]
                        }
                    ]
                },
                // STEP 3: Hub Transfer (Delivery Part 1)
                {
                    sequence: 3,
                    stops: [
                        {
                            address: { street: 'HUB: Vridi, Abidjan', lat: 5.26, lng: -4.01 },
                            actions: [
                                { type: 'DELIVERY', quantity: 1, transit_item_id: 'item_b' }
                            ]
                        }
                    ]
                },
                // STEP 4: Picking from HUB + New Route
                {
                    sequence: 4,
                    stops: [
                        {
                            address: { street: 'HUB: Vridi, Abidjan', lat: 5.26, lng: -4.01 },
                            actions: [{ type: 'PICKUP', quantity: 1, transit_item_id: 'item_c' }]
                        },
                        {
                            address: { street: 'P5: Treichville, Abidjan', lat: 5.31, lng: -4.01 },
                            actions: [{ type: 'PICKUP', quantity: 1, transit_item_id: 'item_a' }] // Picking another 1 unit of A
                        },
                        {
                            address: { street: 'P6: Adjamé, Abidjan', lat: 5.37, lng: -4.02 },
                            actions: [{ type: 'PICKUP', quantity: 5, transit_item_id: 'item_d' }]
                        }
                    ]
                },
                // STEP 5: Final Deliveries
                {
                    sequence: 5,
                    stops: [
                        {
                            address: { street: 'D10: Bingerville', lat: 5.36, lng: -3.89 },
                            actions: [{ type: 'DELIVERY', quantity: 2, transit_item_id: 'item_a' }]
                        },
                        {
                            address: { street: 'D11: Yopougon', lat: 5.34, lng: -4.08 },
                            actions: [{ type: 'DELIVERY', quantity: 1, transit_item_id: 'item_c' }]
                        },
                        {
                            address: { street: 'D12: Abobo', lat: 5.42, lng: -4.01 },
                            actions: [{ type: 'DELIVERY', quantity: 5, transit_item_id: 'item_d' }]
                        }
                    ]
                }
            ]
        }

        const response = await client.post('/v1/orders').loginAs(clientUser).json(payload)

        if (response.status() !== 201) {
            console.log('Case 1 Error Body:', JSON.stringify(response.body(), null, 2))
        }
        response.assertStatus(201)
        const body = response.body()
        assert.equal(body.order.status, 'PENDING')
        // Try both camelCase and snake_case for resilience during dev
        assert.exists(body.order.pricing_data || body.order.pricingData, 'Pricing data should exist')
        assert.isTrue((body.order.total_distance_meters || body.order.totalDistanceMeters) > 0, 'Distance should be > 0')

        // Check that all 5 steps were created
        const resultOrder = await client.get(`/v1/orders/${body.order.id}`).loginAs(clientUser)
        assert.lengthOf(resultOrder.body().steps, 5)
    })

    /**
     * Scenario:
     * Step 1: StopA(-ItemX:1) -> ERROR: Delivery before pickup
     * Step 2: StopB(+ItemX:1)
     */
    test('Case 2: Subtle Sequence Error (Failure - Delivery before Pickup)', async ({ client, assert }) => {
        const payload = {
            transit_items: [{ id: 'item_x', name: 'Item X' }],
            steps: [
                {
                    sequence: 1,
                    stops: [{
                        address: { street: 'Stop A', lat: 5, lng: 5 },
                        actions: [{ type: 'DELIVERY', quantity: 1, transit_item_id: 'item_x' }] // WRONG: Delivering before picking up
                    }]
                },
                {
                    sequence: 2,
                    stops: [{
                        address: { street: 'Stop B', lat: 6, lng: 6 },
                        actions: [{ type: 'PICKUP', quantity: 1, transit_item_id: 'item_x' }]
                    }]
                }
            ]
        }

        const response = await client.post('/v1/orders').loginAs(clientUser).json(payload)

        if (response.status() !== 400) {
            console.log('Case 2 Error Body:', JSON.stringify(response.body(), null, 2))
        }
        response.assertStatus(400)
        assert.include(response.body().message.toLowerCase(), 'validation failed')
        assert.include(response.body().message.toLowerCase(), 'non-viable')
    })

    /**
     * Scenario:
     * Step 1: StopA(+ItemY:10), StopB(-ItemY:8) -> ERROR: Final balance +2 (+ItemY:2)
     */
    test('Case 3: Quantity Imbalance (Failure - Final balance is Not 0)', async ({ client, assert }) => {
        const payload = {
            transit_items: [{ id: 'item_y', name: 'Item Y' }],
            steps: [
                {
                    sequence: 1,
                    stops: [
                        {
                            address: { street: 'Stop A', lat: 5, lng: 5 },
                            actions: [{ type: 'PICKUP', quantity: 10, transit_item_id: 'item_y' }]
                        },
                        {
                            address: { street: 'Stop B', lat: 6, lng: 6 },
                            actions: [{ type: 'DELIVERY', quantity: 8, transit_item_id: 'item_y' }] // WRONG: 2 units left in truck
                        }
                    ]
                }
            ]
        }

        const response = await client.post('/v1/orders').loginAs(clientUser).json(payload)

        if (response.status() !== 400) {
            console.log('Case 3 Error Body:', JSON.stringify(response.body(), null, 2))
        }
        response.assertStatus(400)
        assert.include(response.body().message.toLowerCase(), 'validation failed')
        assert.include(response.body().message.toLowerCase(), 'incomplete mission')
    })

    /**
     * Scenario:
     * Step 1: Missing mandatory "street" field in address
     */
    test('Case 4: Schema Validation (Failure - Missing Street)', async ({ client }) => {
        const payload = {
            steps: [
                {
                    stops: [
                        {
                            address: { lat: 5, lng: 5 }, // MISSING STREET
                            actions: [{ type: 'PICKUP', quantity: 1 }]
                        }
                    ]
                }
            ]
        }

        const response = await client.post('/v1/orders').loginAs(clientUser).json(payload)

        // VERIFICATION: 400 Bad Request (VineJS)
        response.assertStatus(400)
    })

    /**
     * Scenario:
     * Item declared but not used in any action.
     * Expect: 400 Bad Request (Warning: Unused transit item)
     */
    test('Case 5: Orphaned Transit Item (Warning)', async ({ client, assert }) => {
        const payload = {
            transit_items: [
                { id: 'item_used', name: 'Used Item', quantity: 1 },
                { id: 'item_unused', name: 'Unused Item', quantity: 1 }
            ],
            steps: [
                {
                    sequence: 0,
                    stops: [
                        {
                            address: { street: '123 Pickup St', city: 'Paris', country: 'France' },
                            actions: [{ type: 'pickup', transit_item_id: 'item_used', quantity: 1 }]
                        },
                        {
                            address: { street: '456 Delivery Ave', city: 'Paris', country: 'France' },
                            actions: [{ type: 'delivery', transit_item_id: 'item_used', quantity: 1 }]
                        }
                    ]
                }
            ]
        }

        const response = await client.post('/v1/orders').loginAs(clientUser).json(payload)

        if (response.status() !== 400) {
            console.log('Case 5 Error Body:', JSON.stringify(response.body(), null, 2))
        }
        response.assertStatus(400)
        assert.include(response.body().message.toLowerCase(), 'unused transit item')
    })

    /**
     * Scenario:
     * 2 items left in truck.
     * Expect: 400 Bad Request (2 distinct Warnings)
     */
    test('Case 6: Multiple Warnings (Items left in truck)', async ({ client, assert }) => {
        const payload = {
            transit_items: [
                { id: 'item_A', name: 'Item A', quantity: 1 },
                { id: 'item_B', name: 'Item B', quantity: 1 }
            ],
            steps: [
                {
                    sequence: 0,
                    stops: [
                        {
                            address: { street: 'Pickup A & B', city: 'Paris', country: 'France' },
                            actions: [
                                { type: 'pickup', transit_item_id: 'item_A', quantity: 1 },
                                { type: 'pickup', transit_item_id: 'item_B', quantity: 1 }
                            ]
                        }
                        // No delivery
                    ]
                }
            ]
        }

        const response = await client.post('/v1/orders').loginAs(clientUser).json(payload)
        response.assertStatus(400)
        const msg = response.body().message.toLowerCase()
        assert.include(msg, 'incomplete mission')
        // Check existence of both Item Names in the warning message
        assert.include(msg, 'item a')
        assert.include(msg, 'item b')
    })

    /**
     * Scenario:
     * Delivery without Pickup (Error) AND Item left in truck (Warning).
     * Expect: 400 Bad Request (Error + Warning)
     */
    test('Case 7: Mixed Severity (Error + Warning)', async ({ client, assert }) => {
        const payload = {
            transit_items: [
                { id: 'item_error', name: 'Item Error', quantity: 1 },
                { id: 'item_warning', name: 'Item Warning', quantity: 1 }
            ],
            steps: [
                {
                    sequence: 0,
                    stops: [
                        { // Pickup Warning only
                            address: { lat: 48.8566, lng: 2.3522, street: 'Pickup Warning' }, // GEODATA
                            actions: [{ type: 'pickup', transit_item_id: 'item_warning', quantity: 1 }]
                        },
                        { // Delivery Error (No previous pickup for item_error)
                            address: { lat: 48.8566, lng: 2.3522, street: 'Delivery Error' }, // GEODATA
                            actions: [{ type: 'delivery', transit_item_id: 'item_error', quantity: 1 }]
                        }
                    ]
                }
            ]
        }

        const response = await client.post('/v1/orders').loginAs(clientUser).json(payload)
        response.assertStatus(400)
        const msg = response.body().message.toLowerCase()
        assert.include(msg, '[error]')
        assert.include(msg, 'step is non-viable') // for item_error
        assert.include(msg, '[warning]')
        assert.include(msg, 'incomplete mission') // for item_warning
    })

    /**
     * Scenario:
     * Action type logic violation (Pickup Quantity 0).
     */
    test('Case 8: Action Logic Violation (Pickup Quantity 0 -> Auto-Corrected to 1)', async ({ client, assert }) => {
        const payload = {
            transit_items: [{ id: 'item_1', name: 'Item 1' }],
            steps: [
                {
                    sequence: 0,
                    stops: [
                        {
                            address: { lat: 48.8566, lng: 2.3522, street: 'Service Loc' },
                            actions: [
                                { type: 'pickup', transit_item_id: 'item_1', quantity: 0 } // Auto-corrected to 1
                            ]
                        }
                    ]
                }
            ]
        }

        const response = await client.post('/v1/orders').loginAs(clientUser).json(payload)
        response.assertStatus(400)
        const msg = response.body().message.toLowerCase()
        // Expect Warning because item is picked up (qty 1) but not delivered
        assert.include(msg, 'incomplete mission')
    })

    /**
     * Scenario:
     * Multi-step viability.
     * Step 1: Delivery (Error because no pickup yet).
     * Step 2: Pickup (Too late).
     */
    test('Case 9: Multi-Step Viability', async ({ client, assert }) => {
        const payload = {
            transit_items: [{ id: 'item_1', name: 'Item 1', quantity: 1 }],
            steps: [
                {
                    sequence: 0,
                    stops: [{
                        address: { lat: 48.8566, lng: 2.3522, street: 'Delivery First' },
                        actions: [{ type: 'delivery', transit_item_id: 'item_1', quantity: 1 }]
                    }]
                },
                {
                    sequence: 1,
                    stops: [{
                        address: { lat: 48.8566, lng: 2.3522, street: 'Pickup Later' },
                        actions: [{ type: 'pickup', transit_item_id: 'item_1', quantity: 1 }]
                    }]
                }
            ]
        }

        const response = await client.post('/v1/orders').loginAs(clientUser).json(payload)
        response.assertStatus(400)
        assert.include(response.body().message.toLowerCase(), 'step is non-viable')
    })

    /**
     * Scenario:
     * Unknown transit item usage.
     */
    test('Case 10: Unknown Transit Item Reference', async ({ client, assert }) => {
        const payload = {
            transit_items: [{ id: 'item_A', name: 'A', quantity: 1 }],
            steps: [{
                sequence: 0,
                stops: [{
                    address: { lat: 48.8566, lng: 2.3522, street: 'Street' },
                    actions: [{ type: 'pickup', transit_item_id: 'item_UNKNOWN', quantity: 1 }]
                }]
            }]
        }

        const response = await client.post('/v1/orders').loginAs(clientUser).json(payload)
        response.assertStatus(400)
        assert.include(response.body().message.toLowerCase(), 'transit item not found')
    })

})
