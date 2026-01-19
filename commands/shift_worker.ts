import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { shiftWorker } from '#queues/shift_queue'
import { locationWorker, closeLocationQueue } from '#queues/location_queue'

/**
 * Commande shift:worker
 * 
 * Démarre les workers BullMQ pour les shifts et le tracking.
 */
export default class ShiftWorker extends BaseCommand {
    static commandName = 'shift:worker'
    static description = 'Démarre les workers BullMQ (Shifts + Location)'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('Starting workers (Shift + Location)...')
        this.logger.info('Workers are now listening. Press Ctrl+C to stop.')

        // Les workers sont démarrés à l'import
        await new Promise((resolve) => {
            const shutdown = async () => {
                this.logger.info('Shutting down workers...')
                await shiftWorker.close()
                await locationWorker.close()
                await closeLocationQueue()
                resolve(true)
            }

            process.on('SIGINT', shutdown)
            process.on('SIGTERM', shutdown)
        })

        this.logger.success('Workers stopped gracefully')
    }
}
