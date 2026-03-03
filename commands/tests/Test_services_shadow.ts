import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import { inject } from '@adonisjs/core'

@inject()
export default class TestServicesShadow extends BaseCommand {
    static commandName = 'test:services:shadow'
    static description = 'Test Shadow Mechanism Services Directly'

    static options: CommandOptions = {
        startApp: false // Manual boot to avoid server context issues
    }

    private async waitHere(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    async run() {
        console.log('DEBUG: COMMAND RUN STARTED')

        // Manually boot the app
        await this.app.boot()

        // Resolve services manually since strict injection might require boot
        const db = await this.app.container.make('lucid.db')
        const User = (await import('#models/user')).default
        const OrderDraftService = (await import('#services/order/order_draft_service')).default
        const StopService = (await import('#services/order/stop_service')).default
        const ActionService = (await import('#services/order/action_service')).default
        const TransitItemService = (await import('#services/order/transit_item_service')).default

        // Resolve instances from container
        const orderDraftService = await this.app.container.make(OrderDraftService)
        const stopService = await this.app.container.make(StopService)
        const actionService = await this.app.container.make(ActionService)
        const transitItemService = await this.app.container.make(TransitItemService)

        this.logger.info('Starting Service-Level Shadow Tests...')

        // START GLOBAL TRANSACTION
        const trx = await db.transaction()

        try {
            // 1. Setup User
            const clientUser = await User.findOrFail('usr_ff2u5koqimaq025q9u', { client: trx })
            this.logger.success(`User loaded: ${clientUser.email} (${clientUser.id})`)

            // 2. Initiate Order
            this.logger.info('--- Step 1: Initiate Order ---')
            const order = await orderDraftService.initiateOrder(clientUser.id, { ref_id: 'SRV-TEST-001' }, trx)
            this.logger.info(`Order created: ${order.id}`)
            await this.waitHere(200)

            const stepId = order.steps[0].id

            // 3. Add Item, Stop, Action
            this.logger.info('--- Step 2: Add Components ---')

            // Add Stop
            const stopRes = await stopService.addStop(stepId, clientUser.id, {
                address: { street: 'Origin St', lat: 10, lng: 10, formatted_address: 'Origin St' }
            }, trx)
            const stopId = stopRes.entity!.id
            await this.waitHere(200)

            // Add Action with NEW Item
            const actionRes = await actionService.addAction(stopId, clientUser.id, {
                type: 'pickup',
                quantity: 5,
                transit_item: { name: 'Prototype Item', weight: 1000 }
            }, trx)
            const actionId = actionRes.entity!.id
            const originalItemId = actionRes.entity!.transitItemId!
            await this.waitHere(200)

            this.logger.info(`Stop: ${stopId}, Action: ${actionId}, Item: ${originalItemId}`)

            // Add Destination Stop
            const destStopRes = await stopService.addStop(stepId, clientUser.id, {
                address: { street: 'Dest St', lat: 12, lng: 12, formatted_address: 'Dest St' }
            }, trx)
            const destStopId = destStopRes.entity!.id
            await this.waitHere(200)

            // Add Delivery Action
            await actionService.addAction(destStopId, clientUser.id, {
                type: 'delivery',
                quantity: 5,
                transit_item_id: originalItemId
            }, trx)
            await this.waitHere(200)

            // 4. Submit Order
            this.logger.info('--- Step 3: Submit Order ---')
            await orderDraftService.submitOrder(order.id, clientUser.id, trx)
            this.logger.success('Order Submitted')
            await this.waitHere(200)

            // 5. Create Shadows
            this.logger.info('--- Step 4: Create Shadows ---')

            // Shadow Stop
            const shadowStopRes = await stopService.updateStop(stopId, clientUser.id, {
                address: { street: 'Shadow St', lat: 20, lng: 20, formatted_address: 'Shadow St' }
            }, trx)
            const shadowStopId = shadowStopRes.entity!.id
            await this.waitHere(200)

            if (shadowStopId === stopId) throw new Error('Stop Shadowing Failed: IDs match')
            this.logger.info(`Shadow Stop Created: ${shadowStopId}`)

            // Shadow Item
            const shadowItemRes = await transitItemService.updateTransitItem(originalItemId, clientUser.id, {
                weight: 2000
            }, trx)
            const shadowItemId = shadowItemRes.entity!.id
            await this.waitHere(200)

            if (shadowItemId === originalItemId) throw new Error('Item Shadowing Failed: IDs match')
            this.logger.info(`Shadow Item Created: ${shadowItemId}, Weight: ${shadowItemRes.entity!.weight}`)

            // Add Action to Shadow Stop (Strict Anchoring Test)
            const newActionRes = await actionService.addAction(shadowStopId, clientUser.id, {
                type: 'delivery',
                quantity: 1
            }, trx)
            const newActionStopId = newActionRes.entity!.stopId
            await this.waitHere(200)

            if (newActionStopId !== stopId) {
                throw new Error(`Strict Anchoring Failed: Action linked to ${newActionStopId} instead of original ${stopId}`)
            }
            this.logger.success('Strict Anchoring Verified')

            // 6. Verify Virtual State (CLIENT VIEW)
            this.logger.info('--- Step 5: Verify Virtual State (CLIENT) ---')
            const virtualOrder = await orderDraftService.getOrderDetails(order.id, clientUser.id, { trx })
            await this.waitHere(200)

            const vStop = virtualOrder.steps[0].stops[0]
            const vItem = virtualOrder.transitItems.find((t:any) => t.id === shadowItemId)

            if (vStop.id !== shadowStopId) throw new Error('Virtual State: Stop ID mismatch')
            if (!vItem || vItem.weight !== 2000) throw new Error('Virtual State: Item weight mismatch')

            this.logger.success('Virtual State Verified (CLIENT)')

            // 7. Verify Virtual State (DRIVER VIEW)
            this.logger.info('--- Step 6: Verify Virtual State (DRIVER) ---')

            // Re-fetch raw order to simulate distinct Driver request (Driver View should ignore pending changes)
            const rawOrder = await (await import('#models/order')).default.query({ client: trx })
                .where('id', order.id)
                .preload('steps', (q) => q.orderBy('sequence', 'asc').preload('stops', (sq) => sq.orderBy('display_order', 'asc').preload('actions', (aq) => aq.preload('transitItem'))))
                .preload('transitItems')
                .firstOrFail()

            const vsDriver = orderDraftService.buildVirtualState(rawOrder, { view: 'DRIVER' })

            const driverItemNames = vsDriver.transit_items.map((ti: any) => ti.id)
            if (driverItemNames.includes(shadowItemId)) throw new Error('Driver View Failed: Shadow item visible')
            if (!driverItemNames.includes(originalItemId)) throw new Error('Driver View Failed: Original item hidden')

            this.logger.success('Virtual State Verified (DRIVER)')

            // 8. Undo Changes (Revert)
            this.logger.info('--- Step 7: Revert Changes (Undo) ---')
            await orderDraftService.revertPendingChanges(order.id, trx)
            await this.waitHere(200)

            // Verify shadows are gone
            const postRevertItem = await transitItemService.findTransitItem(shadowItemId, trx)
            if (postRevertItem) throw new Error('Undo Failed: Shadow item still exists')

            // Verify original restored
            const restoredItem = await transitItemService.findTransitItem(originalItemId, trx)
            if (restoredItem!.weight !== 1000) throw new Error(`Undo Failed: Original weight is ${restoredItem!.weight}, expected 1000`)

            this.logger.success('Undo Verified: Shadows removed, original state restored')


            // 9. Deletion Test
            this.logger.info('--- Step 8: Deletion Handling ---')
            // Re-create shadow item manually logic or via service
            const delShadowRes = await transitItemService.updateTransitItem(originalItemId, clientUser.id, { weight: 3000 }, trx)
            const delShadowId = delShadowRes.entity!.id

            const shadowTi = await (await import('#models/transit_item')).default.findOrFail(delShadowId, { client: trx })
            shadowTi.isDeleteRequired = true
            await shadowTi.useTransaction(trx).save()

            this.logger.info('Marked shadow item for deletion')

            // Push Updates
            await orderDraftService.pushUpdates(order.id, clientUser.id, trx)
            await this.waitHere(200)

            // Verify original is deleted
            const finalDeletedItem = await transitItemService.findTransitItem(originalItemId, trx)
            if (finalDeletedItem) throw new Error('Deletion Failed: Original item still exists after merge')

            this.logger.success('Deletion Verified: Original item removed')


        } catch (error) {
            this.logger.error('TEST FAILED')
            this.logger.error(error)
        } finally {
            this.logger.warning('Rolling back transaction...')
            await trx.rollback()
            this.logger.info('Done.')
        }
    }
}
