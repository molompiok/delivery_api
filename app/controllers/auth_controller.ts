import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import AuthService from '#services/auth_service'
import NotificationService from '#services/notification_service'
import { inject } from '@adonisjs/core'

const sendPhoneOtpValidator = vine.compile(
    vine.object({
        phone: vine.string().trim().regex(/^\+[0-9]{8,15}$/),
    })
)

const verifyPhoneOtpValidator = vine.compile(
    vine.object({
        phone: vine.string().trim().regex(/^\+[0-9]{8,15}$/),
        otp: vine.string().trim().minLength(4).maxLength(10),
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
        photos: vine.any().optional(),
        addressPhotos: vine.any().optional(),
    }).allowUnknownProperties()
)

const updateFcmTokenValidator = vine.compile(
    vine.object({
        fcm_token: vine.string().trim(),
    })
)

const sendTestPushValidator = vine.compile(
    vine.object({
        title: vine.string().trim().minLength(2).maxLength(120).optional(),
        body: vine.string().trim().minLength(2).maxLength(300).optional(),
    })
)

@inject()
export default class AuthController {
    constructor(protected authService: AuthService) { }

    /**
     * Google OAuth Redirect
     */
    public async googleRedirect({ ally }: HttpContext) {
        return ally.use('google').redirect()
    }

    /**
     * Google OAuth Callback
     */
    public async googleCallback({ ally, response }: HttpContext) {
        try {
            const google = ally.use('google')

            if (google.accessDenied()) return response.badRequest({ message: 'Access denied' })
            if (google.stateMisMatch()) return response.badRequest({ message: 'State mismatch' })
            if (google.hasError()) return response.badRequest({ message: google.getError() })

            const googleUser = await google.user()
            const result = await this.authService.handleOAuthUser(googleUser)

            return response.ok(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Public Phone Login: Send SMS OTP
     */
    public async sendPhoneOtp({ request, response }: HttpContext) {
        try {
            const { phone } = await request.validateUsing(sendPhoneOtpValidator)
            const result = await this.authService.sendPhoneOtp(phone)
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
            console.log({ otp, phone });

            const result = await this.authService.verifyPhoneOtp(phone, otp)
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
            const result = await this.authService.generateApiKey(userId, name)
            return response.created(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    public async listApiKeys({ params, response }: HttpContext) {
        try {
            const keys = await this.authService.listApiKeys(params.userId)
            return response.ok(keys.map(k => ({
                id: k.id,
                name: k.name,
                hint: k.hint,
                isActive: k.isActive,
                createdAt: k.createdAt
            })))
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Delete (deactivate) an API Key
     */
    public async deleteApiKey({ params, response }: HttpContext) {
        try {
            await this.authService.deleteApiKey(params.keyId)
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
        await user.loadFiles()
        return response.ok(user.serialize())
    }

    /**
     * Update Current User Profile
     */
    public async updateProfile(ctx: HttpContext) {
        try {
            const { auth, request, response } = ctx
            const user = auth.user!
            const data = await request.validateUsing(updateProfileValidator)
            const updated = await this.authService.updateProfile(ctx, user, data)
            return response.ok({
                message: 'Profile updated successfully',
                user: updated
            })
        } catch (error: any) {
            return ctx.response.badRequest({ message: error.message })
        }
    }

    /**
     * Update Current User FCM Token
     */
    public async updateFcmToken({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { fcm_token } = await request.validateUsing(updateFcmTokenValidator)
            user.fcmToken = fcm_token
            await user.save()
            return response.ok({ message: 'FCM Token updated successfully' })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Send a test push notification to the authenticated user
     */
    public async sendTestPush({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user!
            const { title, body } = await request.validateUsing(sendTestPushValidator)

            await NotificationService.sendTestPush(user, {
                title,
                body,
                data: { source: 'auth_test_route' },
            })

            return response.ok({
                message: 'Test notification queued',
                userId: user.id,
                phone: user.phone,
                hasFcmToken: Boolean(user.fcmToken),
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
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
