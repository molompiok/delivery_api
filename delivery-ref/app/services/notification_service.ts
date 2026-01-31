import User from '#models/user'
import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'
import env from '#start/env'
import admin from 'firebase-admin'

/**
 * NotificationService
 * 
 * Gère l'envoi de notifications Push (FCM) et SMS.
 * 
 * L'architecture permet de basculer entre différents canaux de communication
 * sans modifier les appels dans le reste du code.
 */

export interface NotificationPayload {
    title: string
    body: string
    data?: Record<string, any>
}

export type SendNotificationResult =
    | { success: true; messageId: string }
    | { success: false; error: any; code?: string; isTokenInvalid?: boolean }

export class NotificationService {
    private isFirebaseInitialized = false

    private async initializeFirebaseApp() {
        if (this.isFirebaseInitialized) return

        try {
            const serviceAccount = {
                type: env.get('FIREBASE_TYPE'),
                project_id: env.get('FIREBASE_PROJECT_ID'),
                private_key_id: env.get('FIREBASE_PRIVATE_KEY_ID'),
                private_key: env.get('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n'),
                client_email: env.get('FIREBASE_CLIENT_EMAIL'),
                client_id: env.get('FIREBASE_CLIENT_ID'),
                auth_uri: env.get('FIREBASE_AUTH_URI'),
                token_uri: env.get('FIREBASE_TOKEN_URI'),
                auth_provider_x509_cert_url: env.get('FIREBASE_AUTH_PROVIDER_X509_CERT_URL'),
                client_x509_cert_url: env.get('FIREBASE_CLIENT_X509_CERT_URL'),
                universe_domain: env.get('FIREBASE_UNIVERSE_DOMAIN'),
            }

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
            })

            this.isFirebaseInitialized = true
            console.log('[NOTIFICATION] Firebase Admin SDK initialisé.')
        } catch (error) {
            console.error('[NOTIFICATION] Erreur initialisation Firebase Admin SDK:', error)
        }
    }

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
                ...(details || {})
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
     */
    private async send(user: User, payload: NotificationPayload) {
        console.log(`[NOTIFICATION] Sending to User ${user.id} (${user.fullName || user.phone})`)

        // 1. Essayer l'envoi par Push si un token est disponible
        if (user.fcmToken) {
            const result = await this.sendViaPush(user.fcmToken, payload)
            if (result.success) {
                console.log(`[PUSH] Sent successfully to ${user.id}`)
            } else if (result.isTokenInvalid) {
                console.warn(`[PUSH] Invalid token for user ${user.id}, removing it.`)
                await this.removeInvalidToken(user)
            }
        }

        // 2. Fallback SMS si configuré (provisoire)
        if (user.phone) {
            await this.sendViaSMS(user.phone, payload.body)
        }

        // 3. Persister en base pour historique
        await this.saveToDatabase(user.id, payload)
    }

    /**
     * Envoi réel via FCM
     */
    private async sendViaPush(fcmToken: string, payload: NotificationPayload): Promise<SendNotificationResult> {
        await this.initializeFirebaseApp()

        if (!this.isFirebaseInitialized) {
            return { success: false, error: new Error('Firebase not initialized'), code: 'FIREBASE_NOT_INIT' }
        }

        const isHighPriority = payload.data?.type === 'NEW_MISSION_OFFER' ||
            payload.data?.type === 'MISSION_UPDATE' ||
            payload.data?.type === 'SHIFT_REMINDER'

        const androidChannelId = isHighPriority
            ? env.get('ANDROID_HIGH_PRIORITY_CHANNEL_ID', 'high_priority_channel')
            : env.get('ANDROID_DEFAULT_CHANNEL_ID', 'default_channel')

        const soundAndroid = isHighPriority
            ? env.get('FCM_OFFER_SOUND_ANDROID', 'custom_offer_sound')
            : env.get('FCM_DEFAULT_SOUND_ANDROID', 'default')

        const soundIOS = isHighPriority
            ? env.get('FCM_OFFER_SOUND_IOS', 'custom_offer_sound.wav')
            : env.get('FCM_DEFAULT_SOUND_IOS', 'default')

        const message: admin.messaging.Message = {
            notification: {
                title: payload.title,
                body: payload.body
            },
            android: {
                priority: isHighPriority ? 'high' : 'normal',
                notification: {
                    channelId: androidChannelId,
                    sound: soundAndroid,
                    visibility: 'public',
                    notificationCount: 1,
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: soundIOS,
                        badge: 1,
                    },
                },
                headers: {
                    'apns-priority': isHighPriority ? '10' : '5',
                    'apns-push-type': 'alert'
                },
            },
            token: fcmToken,
            data: payload.data ? this.stringifyDataPayload(payload.data) : {},
        }

        try {
            const response = await admin.messaging().send(message)
            return { success: true, messageId: response }
        } catch (error: any) {
            const errorCode = error.code
            const isTokenInvalid =
                errorCode === 'messaging/registration-token-not-registered' ||
                errorCode === 'messaging/invalid-registration-token'

            return {
                success: false,
                error: error,
                code: errorCode,
                isTokenInvalid
            }
        }
    }

    /**
     * Convertit toutes les valeurs du data payload en string (requis par FCM)
     */
    private stringifyDataPayload(data: Record<string, any>): Record<string, string> {
        const stringified: Record<string, string> = {}
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'string') {
                stringified[key] = value
            } else {
                stringified[key] = JSON.stringify(value)
            }
        }
        return stringified
    }

    /**
     * Supprime un token invalide de la base
     */
    private async removeInvalidToken(user: User) {
        try {
            user.fcmToken = null
            await user.save()
        } catch (error) {
            console.error(`[NOTIFICATION] Error removing token for user ${user.id}:`, error)
        }
    }

    /**
     * Envoi via SMS (provisoire)
     */
    private async sendViaSMS(phone: string, message: string) {
        try {
            // TODO: Intégrer avec le SmsService existant si besoin réel
            console.log(`[SMS] To ${phone}: ${message}`)
        } catch (error) {
            console.error('[SMS] Error sending SMS:', error)
        }
    }

    /**
     * Sauvegarde en base de données
     */
    private async saveToDatabase(userId: string, payload: NotificationPayload) {
        try {
            // TODO: Créer un modèle Notification si besoin d'historique persistant
            console.log(`[DB] Logged notification for User ${userId}: ${payload.title}`)
        } catch (error) {
            console.error('[NOTIFICATION] Error saving to database:', error)
        }
    }

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
