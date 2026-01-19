import User from '#models/user'
import ApiKey from '#models/api_key'
import AsyncConfirm, { AsyncConfirmType } from '#models/async_confirm'
import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { generateId } from '../utils/id_generator.js'

export class AuthService {
    /**
     * Send OTP to phone number
     */
    async sendPhoneOtp(phone: string) {
        if (!phone) {
            throw new Error('Phone number is required')
        }

        const user = await User.findBy('phone', phone)
        const userId = user ? user.id : null

        // Rate limiting: 5 attempts per hour
        const oneHourAgo = DateTime.now().minus({ hours: 1 }).toSQL()
        let recentAttemptsQuery = AsyncConfirm.query()
            .where('type', AsyncConfirmType.PHONE_OTP)
            .where('createdAt', '>', oneHourAgo)

        if (userId) {
            recentAttemptsQuery = recentAttemptsQuery.where('userId', userId)
        } else {
            recentAttemptsQuery = recentAttemptsQuery.whereRaw("payload->>'phone' = ?", [phone])
        }

        const recentAttempts = await recentAttemptsQuery.count('* as total')
        const attemptsCount = parseInt(recentAttempts[0].$extras.total || '0')

        if (attemptsCount >= 5) {
            throw new Error('Too many attempts. Please try again in an hour.')
        }

        // Rate Limiting: 30s between retries
        let lastAttemptQuery = AsyncConfirm.query()
            .where('type', AsyncConfirmType.PHONE_OTP)
            .orderBy('createdAt', 'desc')

        if (userId) {
            lastAttemptQuery = lastAttemptQuery.where('userId', userId)
        } else {
            lastAttemptQuery = lastAttemptQuery.whereRaw("payload->>'phone' = ?", [phone])
        }

        const lastAttempt = await lastAttemptQuery.first()

        if (lastAttempt && lastAttempt.createdAt.diffNow('seconds').seconds > -30) {
            throw new Error('Please wait 30 seconds before retrying.')
        }

        // Invalidate previous OTPs
        if (userId) {
            await AsyncConfirm.query()
                .where('userId', userId)
                .where('type', AsyncConfirmType.PHONE_OTP)
                .whereNull('usedAt')
                .update({ usedAt: DateTime.now() })
        } else {
            await AsyncConfirm.query()
                .whereRaw("payload->>'phone' = ?", [phone])
                .where('type', AsyncConfirmType.PHONE_OTP)
                .whereNull('usedAt')
                .update({ usedAt: DateTime.now() })
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString()
        const otpHash = await hash.make(otp)

        await AsyncConfirm.create({
            userId: userId,
            tokenHash: otpHash,
            type: AsyncConfirmType.PHONE_OTP,
            expiresAt: DateTime.now().plus({ minutes: 5 }),
            payload: { phone }
        })

        const smsService = (await import('#services/sms_service')).default
        const smsSent = await smsService.send({
            to: phone,
            content: `Votre code de vérification Sublymus est : ${otp}`
        })

        // Return OTP even if SMS fails (for development/testing when quota exceeded)
        return {
            otp,
            smsSent,
            message: smsSent ? 'OTP sent via SMS' : 'SMS failed - OTP returned for testing'
        }
    }

    /**
     * Verify OTP and return user + token
     */
    async verifyPhoneOtp(phone: string, otp: string) {
        if (!otp || !phone) {
            throw new Error('OTP and Phone number are required')
        }

        const confirm = await AsyncConfirm.query()
            .whereRaw("payload->>'phone' = ?", [phone])
            .where('type', AsyncConfirmType.PHONE_OTP)
            .where('expiresAt', '>', DateTime.now().toSQL())
            .whereNull('usedAt')
            .orderBy('createdAt', 'desc')
            .first()

        if (!confirm || !(await hash.verify(confirm.tokenHash, otp))) {
            throw new Error('Invalid or expired OTP')
        }

        let user = await User.findBy('phone', phone)
        if (!user) {
            user = await User.create({
                phone,
                isActive: true,
                phoneVerifiedAt: DateTime.now()
            })
        } else if (!user.phoneVerifiedAt) {
            user.phoneVerifiedAt = DateTime.now()
        }

        user.lastLoginAt = DateTime.now()
        await user.save()

        confirm.usedAt = DateTime.now()
        confirm.userId = user.id
        await confirm.save()

        const token = await User.accessTokens.create(user)

        return {
            token: token.value!.release(),
            user: {
                id: user.id,
                email: user.email,
                phone: user.phone,
                fullName: user.fullName,
                isDriver: user.isDriver,
                isAdmin: user.isAdmin,
            }
        }
    }

    /**
     * Generate API Key
     */
    async generateApiKey(userId: string, name: string) {
        const user = await User.find(userId)
        if (!user) throw new Error('User not found')

        const existingKeysCount = await ApiKey.query()
            .where('userId', user.id)
            .where('isActive', true)
            .count('* as total')

        if (parseInt(existingKeysCount[0].$extras.total || '0') >= 10) {
            throw new Error('Maximum API key limit reached (10 keys per user).')
        }

        const rawKey = generateId('sk').replace('sk_', '')
        const keyHash = await hash.make(rawKey)
        const hint = rawKey.slice(-4)

        const apiKey = await ApiKey.create({
            userId: user.id,
            name,
            keyHash,
            hint,
            isActive: true
        })

        return {
            id: apiKey.id,
            name: apiKey.name,
            key: `sk_${rawKey}`,
            hint: apiKey.hint
        }
    }

    /**
     * Delete API Key
     */
    async deleteApiKey(keyId: string) {
        const apiKey = await ApiKey.find(keyId)
        if (!apiKey) {
            throw new Error('API Key not found')
        }

        apiKey.isActive = false
        await apiKey.save()
        return true
    }
}

export default new AuthService()
