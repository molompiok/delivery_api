import DriverSetting from '#models/driver_setting'
import CompanyDriverSetting from '#models/company_driver_setting'
import { ScheduleType } from '#models/schedule'
import { WorkMode, isTransitioning, getTargetMode } from '#constants/work_mode'
import NotificationService from '#services/notification_service'
import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'

/**
 * ShiftService
 * 
 * Gère la bascule automatique entre les modes IDEP et ETP
 * selon les horaires (schedules) assignés aux drivers.
 * 
 * Logique de bascule intelligente :
 * - Si un shift ETP commence et que le driver a une mission IDEP en cours :
 *   → Passe en IDEP_TO_ETP (ne peut plus recevoir de missions)
 * - Quand la mission se termine, bascule automatiquement en ETP
 * 
 * - Si un shift ETP se termine et que le driver a une mission ETP en cours :
 *   → Passe en ETP_TO_IDEP (ne peut plus recevoir de missions)
 * - Quand la mission se termine, bascule automatiquement en IDEP
 */

export class ShiftService {
    /**
     * Vérifie et met à jour les modes de travail de tous les drivers
     * 
     * Méthode IDEMPOTENTE : peut être appelée plusieurs fois sans effet de bord.
     * 
     * Appelée par le cron toutes les minutes via BullMQ.
     */
    async checkAndSwitchAllDrivers(): Promise<void> {
        console.log(`[SHIFT] Starting shift check at ${DateTime.now().toISO()}`)

        // Récupérer tous les drivers actifs
        const driverSettings = await DriverSetting.query()
            .preload('user')
            .preload('currentCompany')

        let updated = 0
        let errors = 0

        for (const driverSetting of driverSettings) {
            try {
                await this.checkAndSwitchDriver(driverSetting)
                updated++
            } catch (error: any) {
                console.error(`[SHIFT] Error processing driver ${driverSetting.userId}:`, error.message)
                errors++
            }
        }

        console.log(`[SHIFT] Check completed: ${updated} processed, ${errors} errors`)
    }

    /**
     * Vérifie et bascule le mode d'un driver spécifique
     */
    async checkAndSwitchDriver(driverSetting: DriverSetting): Promise<void> {
        const now = DateTime.now()
        const currentMode = driverSetting.currentMode

        // Si en transition, vérifier si on peut finaliser
        if (isTransitioning(currentMode)) {
            await this.handleTransition(driverSetting)
            return
        }

        // Vérifier si un shift ETP est actif maintenant
        const hasActiveShift = await this.hasActiveETPShift(driverSetting.userId, now)

        // Déterminer le mode attendu
        const expectedMode = hasActiveShift ? WorkMode.ETP : WorkMode.IDEP

        // Si le mode actuel correspond au mode attendu, rien à faire
        if (currentMode === expectedMode) {
            return
        }

        // Sinon, tenter la bascule
        if (expectedMode === WorkMode.ETP && currentMode === WorkMode.IDEP) {
            // Shift ETP commence
            await this.switchToETP(driverSetting)
        } else if (expectedMode === WorkMode.IDEP && currentMode === WorkMode.ETP) {
            // Shift ETP se termine
            await this.switchToIDEP(driverSetting)
        }
    }

    /**
     * Bascule vers le mode ETP
     */
    private async switchToETP(driverSetting: DriverSetting): Promise<void> {
        // Vérifier si le driver a une mission en cours
        const hasActiveMission = await this.hasActiveMission(driverSetting.userId)

        if (hasActiveMission) {
            // Mission en cours → Passer en transition
            console.log(`[SHIFT] Driver ${driverSetting.userId} has active mission, going to IDEP_TO_ETP`)
            driverSetting.currentMode = WorkMode.IDEP_TO_ETP
            await driverSetting.save()

            // Notifier le driver
            const user = await driverSetting.related('user').query().first()
            if (user) {
                await NotificationService.sendModeSwitchAlert(user, WorkMode.IDEP_TO_ETP, {
                    message: 'Votre shift ETP commence. Terminez votre mission en cours.'
                })
            }
        } else {
            // Pas de mission → Bascule immédiate
            console.log(`[SHIFT] Driver ${driverSetting.userId} switching to ETP`)
            driverSetting.currentMode = WorkMode.ETP
            await driverSetting.save()

            // Notifier le driver
            const user = await driverSetting.related('user').query().first()
            const company = await driverSetting.related('currentCompany').query().first()
            if (user) {
                await NotificationService.sendModeSwitchAlert(user, WorkMode.ETP, {
                    companyName: (company as any)?.companyName
                })
            }
        }
    }

    /**
     * Bascule vers le mode IDEP
     */
    private async switchToIDEP(driverSetting: DriverSetting): Promise<void> {
        // Vérifier si le driver a une mission en cours
        const hasActiveMission = await this.hasActiveMission(driverSetting.userId)

        if (hasActiveMission) {
            // Mission en cours → Passer en transition
            console.log(`[SHIFT] Driver ${driverSetting.userId} has active mission, going to ETP_TO_IDEP`)
            driverSetting.currentMode = WorkMode.ETP_TO_IDEP
            await driverSetting.save()

            // Notifier le driver
            const user = await driverSetting.related('user').query().first()
            if (user) {
                await NotificationService.sendModeSwitchAlert(user, WorkMode.ETP_TO_IDEP, {
                    message: 'Votre shift ETP est terminé. Terminez votre mission en cours.'
                })
            }
        } else {
            // Pas de mission → Bascule immédiate
            console.log(`[SHIFT] Driver ${driverSetting.userId} switching to IDEP`)
            driverSetting.currentMode = WorkMode.IDEP
            await driverSetting.save()

            // Notifier le driver
            const user = await driverSetting.related('user').query().first()
            if (user) {
                await NotificationService.sendModeSwitchAlert(user, WorkMode.IDEP)
            }
        }
    }

    /**
     * Gère les transitions en attente
     * Si la mission est terminée, finalise la bascule
     */
    private async handleTransition(driverSetting: DriverSetting): Promise<void> {
        const hasActiveMission = await this.hasActiveMission(driverSetting.userId)

        // Si la mission est toujours en cours, on attend
        if (hasActiveMission) {
            return
        }

        // Mission terminée → Finaliser la bascule
        const targetMode = getTargetMode(driverSetting.currentMode)
        if (!targetMode) {
            console.error(`[SHIFT] Invalid transition mode: ${driverSetting.currentMode}`)
            return
        }

        console.log(`[SHIFT] Driver ${driverSetting.userId} transition complete: ${driverSetting.currentMode} → ${targetMode}`)
        driverSetting.currentMode = targetMode
        await driverSetting.save()

        // Notifier le driver
        const user = await driverSetting.related('user').query().first()
        const company = await driverSetting.related('currentCompany').query().first()
        if (user) {
            await NotificationService.sendModeSwitchAlert(user, targetMode, {
                companyName: (company as any)?.companyName
            })
        }
    }

    /**
     * Force manuellement le mode de travail pour la journée en cours
     */
    async forceMode(userId: string, mode: 'IDEP' | 'ETP', companyId?: string): Promise<void> {
        const now = DateTime.now()
        const scheduleType = mode === 'ETP' ? ScheduleType.WORK : ScheduleType.CLOSED

        const ownerType = mode === 'ETP' ? 'Company' : 'User'
        const ownerId = mode === 'ETP' ? companyId! : userId

        if (mode === 'ETP' && !companyId) {
            throw new Error('companyId is required to force ETP mode')
        }

        const Schedule = (await import('#models/schedule')).default
        const { RecurrenceType } = await import('#models/schedule')

        // Créer l'override
        const schedule = await Schedule.create({
            ownerType,
            ownerId,
            scheduleType,
            recurrenceType: RecurrenceType.MANUAL_OVERRIDE,
            specificDate: now,
            startTime: '00:00',
            endTime: '23:59',
            label: `Force switch to ${mode} (Manual)`,
            isActive: true,
            timezone: 'Africa/Abidjan'
        })

        // Assigner le chauffeur si c'est une company
        if (mode === 'ETP') {
            await schedule.related('assignedUsers').attach([userId])
        }

        // Déclencher la bascule immédiate
        const DriverSetting = (await import('#models/driver_setting')).default
        const setting = await DriverSetting.query().where('userId', userId).first()
        if (setting) {
            await this.checkAndSwitchDriver(setting)
        }
    }

    /**
     * Vérifie si le driver a un shift ETP actif à l'instant donné
     */
    private async hasActiveETPShift(userId: string, dateTime: DateTime): Promise<boolean> {
        const relation = await CompanyDriverSetting.query()
            .where('driverId', userId)
            .where('status', 'ACCEPTED')
            .first()

        if (!relation) return false

        // Utilise la résolution de priorité centralisée (SPECIFIC > RANGE > WEEKLY)
        const ScheduleService = (await import('#services/schedule_service')).default
        const effective = await ScheduleService.getEffectiveSchedule(
            'Company',
            relation.companyId,
            dateTime,
            userId
        )

        return effective?.scheduleType === ScheduleType.WORK
    }

    /**
     * Vérifie si le driver a une mission active
     * 
     */
    private async hasActiveMission(userId: string): Promise<boolean> {
        try {
            const Order = (await import('#models/order')).default
            const activeOrder = await Order.query()
                .where('driverId', userId)
                .whereIn('status', ['ACCEPTED', 'AT_PICKUP', 'COLLECTED', 'AT_DELIVERY'])
                .first()

            return !!activeOrder
        } catch (error) {
            console.error('[SHIFT] Error checking active mission:', error)
            return false
        }
    }

    /**
     * Envoie des rappels 15 minutes avant le début d'un shift
     */
    async sendUpcomingShiftReminders(): Promise<void> {
        const in15Minutes = DateTime.now().plus({ minutes: 15 })

        // TODO: Récupérer les schedules qui commencent dans 15 minutes
        // et envoyer des notifications aux drivers assignés

        console.log(`[SHIFT] Checking for shifts starting at ${in15Minutes.toFormat('HH:mm')}`)
    }
}

export default new ShiftService()
