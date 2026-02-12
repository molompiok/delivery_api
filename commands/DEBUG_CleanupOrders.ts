import { BaseCommand } from '@adonisjs/core/ace'
import db from '@adonisjs/lucid/services/db'

export default class CleanupOrders extends BaseCommand {
    static commandName = 'db:cleanup:orders'
    static description = 'Delete all orders, order legs, steps, stops, actions, and proofs'

    async run() {
        await this.app.boot()
        const trx = await db.transaction()

        try {
            this.logger.info('Starting database cleanup...')

            // Use raw queries or Lucid queries. Truncate with CASCADE is most efficient in Postgres.
            // But we will delete in order to be safe if CASCADE level is unclear.

            this.logger.info('Deleting ActionProofs...')
            await trx.from('action_proofs').delete()

            this.logger.info('Deleting Actions...')
            await trx.from('actions').delete()

            this.logger.info('Deleting Stops...')
            await trx.from('stops').delete()

            this.logger.info('Deleting Steps...')
            await trx.from('steps').delete()

            this.logger.info('Deleting TransitItems...')
            await trx.from('transit_items').delete()

            this.logger.info('Deleting OrderLegs...')
            await trx.from('order_legs').delete()

            this.logger.info('Deleting Orders...')
            await trx.from('orders').delete()

            await trx.commit()
            this.logger.success('✅ Database cleanup successful! All orders and related records deleted.')
        } catch (error) {
            await trx.rollback()
            this.logger.error('❌ Database cleanup failed.')
            this.logger.error(error.message)
        }
    }
}
