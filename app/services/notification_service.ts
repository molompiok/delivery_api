import User from '#models/user'
import { DateTime } from 'luxon'

/**
 * NotificationService
 * 
 * Service provisoire pour gérer les notifications.
 * 
 * TODO: Implémenter Firebase Cloud Messaging (FCM) ou autre système de push notifications
 * 
 * Pour le moment, ce service utilise :
 * - L'envoi de SMS via le service SMS existant (à brancher)
 * - Les logs système pour tracer les événements
 * 
 * L'architecture est prête pour être remplacée par un vrai système de push
 * sans modifier les appels dans le reste du code.
 */

export interface NotificationPayload {
    title: string
    body: string
    data?: Record<string, any>
}

export class NotificationService {
    /**
     * Envoie une notification de changement de mode de travail
     */
    async sendModeSwitchAlert(user: User, newMode: string, details?: Record<string, any>) {
        const payload: NotificationPayload = {
            title: this.getModeSwitchTitle(newMode),
            body: this.getModeSwitchBody(newMode, details),
            data: {
                type: 'MODE_SWITCH',
                newMode,
                timestamp: DateTime.now().toISO(),
                ...details
            }
        }

        await this.send(user, payload)
    }

    /**
     * Envoie une notification d'horaire (shift commence bientôt)
     */
    async sendShiftReminder(user: User, shiftStart: DateTime, companyName: string) {
        const payload: NotificationPayload = {
            title: 'Shift à venir',
            body: `Votre shift chez ${companyName} commence dans 15 minutes (${shiftStart.toFormat('HH:mm')})`,
            data: {
                type: 'SHIFT_REMINDER',
                shiftStart: shiftStart.toISO(),
                companyName
            }
        }

        await this.send(user, payload)
    }

    /**
     * Envoie une notification d'invitation
     */
    async sendInvitationAlert(user: User, companyName: string, invitationType: string) {
        const payload: NotificationPayload = {
            title: 'Nouvelle invitation',
            body: `${companyName} vous invite à rejoindre leur flotte`,
            data: {
                type: 'INVITATION',
                companyName,
                invitationType
            }
        }

        await this.send(user, payload)
    }

    /**
     * Méthode centrale d'envoi
     * 
     * TODO: Remplacer par Firebase Cloud Messaging (FCM)
     * 
     * Implémentation provisoire :
     * 1. Log la notification
     * 2. Envoie un SMS si le user a un téléphone
     */
    private async send(user: User, payload: NotificationPayload) {
        // Log pour debug
        console.log(`[NOTIFICATION] User ${user.id} (${user.fullName || user.phone}):`, {
            title: payload.title,
            body: payload.body,
            data: payload.data
        })

        // TODO: Envoyer via FCM
        // await this.sendViaPush(user.fcmToken, payload)

        // Provisoire : Envoyer par SMS si numéro disponible
        if (user.phone) {
            await this.sendViaSMS(user.phone, payload.body)
        }

        // Persister la notification en base pour historique
        await this.saveToDatabase(user.id, payload)
    }

    /**
     * Envoi via SMS (provisoire)
     */
    private async sendViaSMS(phone: string, message: string) {
        try {
            // TODO: Intégrer avec le SmsService existant
            // const SmsService = (await import('#services/sms_service')).default
            // await SmsService.send(phone, message)

            console.log(`[SMS] ${phone}: ${message}`)
        } catch (error) {
            console.error('[SMS] Error sending SMS:', error)
        }
    }

    /**
     * Sauvegarde en base de données (pour historique et consultation depuis l'app)
     */
    private async saveToDatabase(_userId: string, _payload: NotificationPayload) {
        try {
            // TODO: Créer un modèle Notification si besoin d'historique
            // await Notification.create({
            //     userId,
            //     title: payload.title,
            //     body: payload.body,
            //     data: payload.data,
            //     readAt: null
            // })
        } catch (error) {
            console.error('[NOTIFICATION] Error saving to database:', error)
        }
    }

    /**
     * Helpers pour générer les messages
     */
    private getModeSwitchTitle(newMode: string): string {
        const titles: Record<string, string> = {
            'ETP': 'Shift commencé',
            'IDEP': 'Shift terminé',
            'IDEP_TO_ETP': 'Transition en cours',
            'ETP_TO_IDEP': 'Transition en cours'
        }
        return titles[newMode] || 'Changement de mode'
    }

    private getModeSwitchBody(newMode: string, details?: Record<string, any>): string {
        const messages: Record<string, string> = {
            'ETP': `Votre shift ${details?.companyName ? `chez ${details.companyName}` : ''} a commencé. Mode entreprise activé.`,
            'IDEP': 'Votre shift est terminé. Vous êtes maintenant en mode indépendant.',
            'IDEP_TO_ETP': 'Shift ETP commence. Terminez votre mission en cours pour basculer.',
            'ETP_TO_IDEP': 'Shift ETP terminé. Terminez votre mission en cours pour basculer.'
        }
        return messages[newMode] || 'Votre mode de travail a changé'
    }
}

export default new NotificationService()
