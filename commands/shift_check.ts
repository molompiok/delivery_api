import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { shiftQueue } from '#queues/shift_queue'
import { locationQueue } from '#queues/location_queue'

/**
 * Commande shift:check
 * 
 * Vérifie les horaires de tous les drivers et bascule leur mode de travail si nécessaire.
 * 
 * Cette commande est IDEMPOTENTE : elle peut être exécutée plusieurs fois sans effet de bord.
 * 
 * Utilisation :
 * - Manuellement : node ace shift:check
 * - Via cron : chaque minute dans crontab
 * 
 * Le job est envoyé à BullMQ qui le traite de manière asynchrone via un worker.
 */
export default class ShiftCheck extends BaseCommand {
    static commandName = 'shift:check'
    static description = 'Vérifie les horaires et bascule les drivers entre IDEP et ETP'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('Starting shift check...')

        try {
            // Enqueue le job dans BullMQ
            // 1. Déclencher la vérification des shifts (Mode IDEP/ETP)
            const timestamp = new Date().toISOString()
            const jobId = `check-${timestamp.substring(0, 16)}`
            await shiftQueue.add(
                'check-shifts',
                { timestamp: new Date().toISOString() },
                {
                    jobId,
                    priority: 1,
                }
            )

            // 2. Forcer le flush des positions GPS (Sécurité intervalle de 5 min)
            // On le fait systématiquement à chaque passage du cron (si cron = 1 ou 5 min)
            await locationQueue.add('flush-locations', { forced: true })

            this.logger.success('Shift check job enqueued and Location flush triggered')
        } catch (error) {
            this.logger.error('Failed to enqueue shift check job')
            this.logger.error(String(error))
            this.exitCode = 1
        }
    }
}
