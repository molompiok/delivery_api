import User from '#models/user'
import NotificationLog from '#models/notification_log'
import { DateTime } from 'luxon'
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

export interface NotificationOptions {
    type?: string
    orderId?: string | null
    smsFallback?: boolean
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

        await this.send(user, payload, { type: 'MODE_SWITCH' })
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

        await this.send(user, payload, { type: 'SHIFT_REMINDER' })
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

        await this.send(user, payload, { type: 'INVITATION' })
    }

    /**
     * Offre une mission a un chauffeur (priorite haute)
     */
    async sendMissionOffered(user: User, details: { orderId: string, expiresAt: string }) {
        const expiresText = DateTime.fromISO(details.expiresAt).toFormat('HH:mm:ss')
        const payload: NotificationPayload = {
            title: 'Nouvelle mission',
            body: `Une mission vous attend. Repondez avant ${expiresText}.`,
            data: {
                type: 'NEW_MISSION_OFFER',
                orderId: details.orderId,
                expiresAt: details.expiresAt,
                deepLink: `/missions/${details.orderId}`,
                timestamp: DateTime.now().toISO(),
            }
        }

        await this.send(user, payload, {
            type: 'NEW_MISSION_OFFER',
            orderId: details.orderId,
        })
    }

    /**
     * Offre expiree sans reponse
     */
    async sendMissionExpired(user: User, details: { orderId: string }) {
        const payload: NotificationPayload = {
            title: 'Mission expiree',
            body: 'Le delai de reponse est depasse pour cette mission.',
            data: {
                type: 'MISSION_EXPIRED',
                orderId: details.orderId,
                deepLink: '/missions',
                timestamp: DateTime.now().toISO(),
            }
        }

        await this.send(user, payload, {
            type: 'MISSION_EXPIRED',
            orderId: details.orderId,
        })
    }

    /**
     * Mission annulee par le client/ops
     */
    async sendMissionCancelled(user: User, details: { orderId: string, reason?: string }) {
        const payload: NotificationPayload = {
            title: 'Mission annulee',
            body: details.reason
                ? `Mission annulee: ${details.reason}`
                : 'Cette mission a ete annulee.',
            data: {
                type: 'MISSION_CANCELLED',
                orderId: details.orderId,
                reason: details.reason || '',
                deepLink: '/missions',
                timestamp: DateTime.now().toISO(),
            }
        }

        await this.send(user, payload, {
            type: 'MISSION_CANCELLED',
            orderId: details.orderId,
        })
    }

    /**
     * Notification generique d'evolution de mission/commande
     */
    async sendOrderUpdate(user: User, details: { orderId: string, status: string, message?: string }) {
        const payload: NotificationPayload = {
            title: 'Mise a jour mission',
            body: details.message || `Statut mis a jour: ${details.status}`,
            data: {
                type: 'ORDER_UPDATED',
                orderId: details.orderId,
                status: details.status,
                deepLink: `/missions/${details.orderId}`,
                timestamp: DateTime.now().toISO(),
            }
        }

        await this.send(user, payload, {
            type: 'ORDER_UPDATED',
            orderId: details.orderId,
        })
    }

    /**
     * Notification generique pour les actions de gestion chauffeur
     * (invitations, assignations zone/vehicule, horaires, documents, etc.)
     */
    async sendDriverManagementAlert(
        user: User,
        details: {
            title: string
            body: string
            type: string
            data?: Record<string, any>
            smsFallback?: boolean
        }
    ) {
        const payload: NotificationPayload = {
            title: details.title,
            body: details.body,
            data: {
                type: details.type,
                timestamp: DateTime.now().toISO(),
                ...(details.data || {}),
            },
        }

        await this.send(user, payload, {
            type: details.type,
            smsFallback: details.smsFallback ?? false,
        })
    }

    /**
     * Notification de test manuelle (debug/admin)
     */
    async sendTestPush(
        user: User,
        details?: { title?: string; body?: string; data?: Record<string, any> }
    ) {
        const payload: NotificationPayload = {
            title: details?.title || 'Test notification',
            body: details?.body || 'Ceci est une notification de test Sublymus Pro.',
            data: {
                type: 'TEST_PUSH',
                timestamp: DateTime.now().toISO(),
                ...(details?.data || {}),
            }
        }

        await this.send(user, payload, { type: 'TEST_PUSH' })
    }

    /**
     * Méthode centrale d'envoi
     */
    private async send(user: User, payload: NotificationPayload, options: NotificationOptions = {}) {
        console.log(`[NOTIFICATION] Sending to User ${user.id} (${user.fullName || user.phone})`)
        const type = options.type || String(payload.data?.type || 'GENERIC')
        const orderId = options.orderId || this.extractOrderId(payload.data)

        // 1. Essayer l'envoi par Push si un token est disponible
        let pushDelivered = false
        if (user.fcmToken) {
            const result = await this.sendViaPush(user.fcmToken, payload)
            if (result.success) {
                console.log(`[PUSH] Sent successfully to ${user.id}`)
                pushDelivered = true
                await this.saveToDatabase(user.id, payload, {
                    channel: 'PUSH',
                    type,
                    orderId,
                    status: 'SENT',
                    provider: 'firebase',
                    providerMessageId: result.messageId,
                    tokenSnapshot: user.fcmToken,
                })
            } else if (result.isTokenInvalid) {
                console.warn(`[PUSH] Invalid token for user ${user.id}, removing it.`)
                await this.removeInvalidToken(user)
                await this.saveToDatabase(user.id, payload, {
                    channel: 'PUSH',
                    type,
                    orderId,
                    status: 'FAILED',
                    provider: 'firebase',
                    errorCode: result.code,
                    errorMessage: String(result.error?.message || result.error || 'Invalid token'),
                    tokenSnapshot: user.fcmToken,
                })
            } else {
                await this.saveToDatabase(user.id, payload, {
                    channel: 'PUSH',
                    type,
                    orderId,
                    status: 'FAILED',
                    provider: 'firebase',
                    errorCode: result.code,
                    errorMessage: String(result.error?.message || result.error || 'Push send failed'),
                    tokenSnapshot: user.fcmToken,
                })
            }
        } else {
            await this.saveToDatabase(user.id, payload, {
                channel: 'PUSH',
                type,
                orderId,
                status: 'SKIPPED',
                provider: 'firebase',
                errorCode: 'NO_TOKEN',
                errorMessage: 'User has no FCM token',
            })
        }

        // 2. Fallback SMS configurable (uniquement si push non livre)
        const smsFallbackEnabled = options.smsFallback ?? env.get('ENABLE_SMS_FALLBACK', false)
        if (smsFallbackEnabled && user.phone && !pushDelivered) {
            const smsSent = await this.sendViaSMS(user.phone, payload.body)
            await this.saveToDatabase(user.id, payload, {
                channel: 'SMS',
                type,
                orderId,
                status: smsSent ? 'SENT' : 'FAILED',
                provider: 'internal_sms',
                errorCode: smsSent ? null : 'SMS_SEND_FAILED',
                errorMessage: smsSent ? null : 'SMS provider returned false',
            })
        }
    }

    /**
     * Envoi réel via FCM
     */
    private async sendViaPush(fcmToken: string, payload: NotificationPayload): Promise<SendNotificationResult> {
        await this.initializeFirebaseApp()

        if (!this.isFirebaseInitialized) {
            return { success: false, error: new Error('Firebase not initialized'), code: 'FIREBASE_NOT_INIT' }
        }

        const highPriorityTypes = new Set([
            'NEW_MISSION_OFFER',
            'MISSION_UPDATE',
            'SHIFT_REMINDER',
            'MISSION_CANCELLED',
            'MISSION_EXPIRED',
        ])
        const isHighPriority = highPriorityTypes.has(String(payload.data?.type || ''))

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
    private async sendViaSMS(phone: string, message: string): Promise<boolean> {
        try {
            // TODO: Intégrer avec le SmsService existant si besoin réel
            console.log(`[SMS] To ${phone}: ${message}`)
            return true
        } catch (error) {
            console.error('[SMS] Error sending SMS:', error)
            return false
        }
    }

    /**
     * Sauvegarde en base de données
     */
    private async saveToDatabase(
        userId: string,
        payload: NotificationPayload,
        context: {
            channel: 'PUSH' | 'SMS'
            type: string
            orderId?: string | null
            status: 'SENT' | 'FAILED' | 'SKIPPED'
            provider?: string | null
            providerMessageId?: string | null
            errorCode?: string | null
            errorMessage?: string | null
            tokenSnapshot?: string | null
        }
    ) {
        try {
            await NotificationLog.create({
                userId,
                channel: context.channel,
                type: context.type,
                title: payload.title,
                body: payload.body,
                data: payload.data || {},
                orderId: context.orderId || null,
                status: context.status,
                provider: context.provider || null,
                providerMessageId: context.providerMessageId || null,
                errorCode: context.errorCode || null,
                errorMessage: context.errorMessage || null,
                tokenSnapshot: context.tokenSnapshot || null,
            })
        } catch (error) {
            console.error('[NOTIFICATION] Error saving to database:', error)
        }
    }

    private extractOrderId(data?: Record<string, any>): string | null {
        if (!data) return null
        const orderId = data.orderId || data.order_id
        return orderId ? String(orderId) : null
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
