import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import User from '#models/user'
import ApiKey from '#models/api_key'
import AuthService from '#services/auth_service'
import { DateTime } from '../../node_modules/.pnpm/@types+luxon@3.7.1/node_modules/@types/luxon/index.js'

const sendPhoneOtpValidator = vine.compile(
    vine.object({
        phone: vine.string().trim().regex(/^\+[0-9]{8,15}$/),
    })
)

const verifyPhoneOtpValidator = vine.compile(
    vine.object({
        phone: vine.string().trim().regex(/^\+[0-9]{8,15}$/),
        otp: vine.string().trim().minLength(4).maxLength(10), // Allow some flex, usually 6
    })
)

const generateApiKeyValidator = vine.compile(
    vine.object({
        userId: vine.string().trim(),
        name: vine.string().trim().minLength(2),
    })
)

const updateProfileValidator = vine.compile(
    vine.object({
        fullName: vine.string().trim().minLength(2).optional(),
        email: vine.string().trim().email().optional(),
    })
)

const updateFcmTokenValidator = vine.compile(
    vine.object({
        fcm_token: vine.string().trim(),
    })
)

export default class AuthController {
    /**
     * Google OAuth Redirect
     */
    //@ts-ignore
    public async googleRedirect({ ally }: HttpContext) {
        return ally.use('google').redirect()
    }

    /**
     * Google OAuth Callback
     */
    //@ts-ignore
    public async googleCallback({ ally, response }: HttpContext) {
        const google = ally.use('google')

        if (google.accessDenied()) {
            return response.badRequest({ message: 'Access denied' })
        }
        if (google.stateMisMatch()) {
            return response.badRequest({ message: 'State mismatch' })
        }
        if (google.hasError()) {
            return response.badRequest({ message: google.getError() })
        }

        const googleUser = await google.user()

        let user = await User.findBy('email', googleUser.email)
        if (!user) {
            user = await User.create({
                email: googleUser.email,
                fullName: googleUser.name,
                isActive: true,
            })
        }

        user.lastLoginAt = DateTime.now()
        await user.save()

        const token = await User.accessTokens.create(user)

        return response.ok({
            token: token.value!.release(),
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                isDriver: user.isDriver,
                isAdmin: user.isAdmin,
            },
        })
    }

    /**
     * Public Phone Login: Send SMS OTP
     */
    public async sendPhoneOtp({ request, response }: HttpContext) {
        try {
            const { phone } = await request.validateUsing(sendPhoneOtpValidator)
            const result = await AuthService.sendPhoneOtp(phone)
            return response.ok({ message: 'SMS OTP sent', otp: result.otp })
        } catch (error: any) {
            if (error.message.includes('Too many attempts') || error.message.includes('wait 30 seconds')) {
                return response.tooManyRequests({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Public Phone Login: Verify SMS OTP and Return Token
     */
    public async verifyPhoneOtp({ request, response }: HttpContext) {
        try {
            const { otp, phone } = await request.validateUsing(verifyPhoneOtpValidator)
            const result = await AuthService.verifyPhoneOtp(phone, otp)
            return response.ok(result)
        } catch (error: any) {
            return response.unauthorized({ message: error.message })
        }
    }

    /**
     * API Key management
     */
    public async generateApiKey({ request, response }: HttpContext) {
        try {
            const { userId, name } = await request.validateUsing(generateApiKeyValidator)
            const result = await AuthService.generateApiKey(userId, name)
            return response.created(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    public async listApiKeys({ params, response }: HttpContext) {
        const keys = await ApiKey.query().where('userId', params.userId).orderBy('createdAt', 'desc')
        return response.ok(keys.map(k => ({
            id: k.id,
            name: k.name,
            hint: k.hint,
            isActive: k.isActive,
            createdAt: k.createdAt
        })))
    }

    /**
     * Delete (deactivate) an API Key
     */
    public async deleteApiKey({ params, response }: HttpContext) {
        try {
            await AuthService.deleteApiKey(params.keyId)
            return response.ok({ message: 'API Key deleted successfully' })
        } catch (error: any) {
            return response.notFound({ message: error.message })
        }
    }

    /**
     * Get Current User Profile
     */
    public async me({ auth, response }: HttpContext) {
        const user = auth.user!
        return response.ok(user)
    }

    /**
     * Update Current User Profile
     */
    public async updateProfile({ auth, request, response }: HttpContext) {
        const user = auth.user!
        const data = await request.validateUsing(updateProfileValidator)

        user.merge(data)
        await user.save()

        return response.ok({
            message: 'Profile updated successfully',
            user: user
        })
    }

    /**
     * Update Current User FCM Token
     */
    public async updateFcmToken({ auth, request, response }: HttpContext) {
        const user = auth.user!
        const { fcm_token } = await request.validateUsing(updateFcmTokenValidator)

        user.fcmToken = fcm_token
        await user.save()

        return response.ok({
            message: 'FCM Token updated successfully',
        })
    }

    /**
     * Get Public Configuration (e.g. Google Maps key)
     */
    public async getPublicConfig({ response }: HttpContext) {
        return response.ok({
            googleMapsKey: process.env.GOOGLE_MAPS_KEY || '',
        })
    }
}
