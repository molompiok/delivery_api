import { BaseCommand } from '@adonisjs/core/ace'
import { CommandOptions } from '@adonisjs/core/types/ace'
import Order from '#models/order'

export default class BackfillRouteExecution extends BaseCommand {
    static commandName = 'backfill:route_execution'
    static description = 'Backfills metadata.route_execution in orders and deletes empty orders'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('Starting Order Analysis & Cleanup...')

        const orders = await Order.query()
            .preload('steps', (q) => {
                q.orderBy('sequence', 'asc')
                q.preload('stops', (sq) => {
                    sq.orderBy('execution_order', 'asc')
                    sq.orderBy('display_order', 'asc')
                })
            })

        let deletedCount = 0
        let updatedCount = 0
        let skippedCount = 0

        for (const order of orders) {
            const allStops = order.steps.flatMap(s => s.stops || [])

            // 1. CLEANUP: Delete orders with no stops
            if (allStops.length === 0) {
                this.logger.warning(`[DELETE] Order ${order.id} has 0 stops. Deleting...`)
                await order.delete()
                deletedCount++
                continue
            }

            // 2. BACKFILL: Calculate route_execution
            // Check if already correct (optional, but good for idempotency)
            // We force update to ensure consistency with current logic

            const visitedIds: string[] = []
            const remainingIds: string[] = []

            // Sort stops to ensure correct planned order
            // Priority: executionOrder (from Vroom) > displayOrder (Client)
            allStops.sort((a, b) => {
                const orderA = a.executionOrder ?? a.displayOrder
                const orderB = b.executionOrder ?? b.displayOrder
                return orderA - orderB
            })

            const plannedIds = allStops.map(s => s.id)

            for (const stop of allStops) {
                if (['COMPLETED', 'SKIPPED', 'FAILED'].includes(stop.status)) {
                    visitedIds.push(stop.id)
                } else {
                    remainingIds.push(stop.id)
                }
            }

            const meta = order.metadata || {}

            // Update logic
            meta.route_execution = {
                visited: visitedIds,
                remaining: remainingIds,
                planned: plannedIds
            }

            order.metadata = meta

            if (order.$isDirty) {
                await order.save()
                updatedCount++
            } else {
                skippedCount++
            }
        }

        this.logger.success(`\n--- SUMMARY ---`)
        this.logger.success(`Deleted (Empty): ${deletedCount}`)
        this.logger.success(`Updated (Backfilled): ${updatedCount}`)
        this.logger.success(`Skipped (No Change): ${skippedCount}`)
        this.logger.success(`Total Processed: ${orders.length}`)
    }
}
