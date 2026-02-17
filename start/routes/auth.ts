import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const AuthController = () => import('#controllers/auth_controller')

router.group(() => {
    // Public SMS Login/Register
    // Commande a appeler pour recuperer le token
    //curl -s -X POST http://localhost:3333/v1/auth/phone/otp/send -H "Content-Type: application/json" -d '{"phone": "+2250700000101"}' | jq -r '.otp' | xargs -I {} curl -X POST http://localhost:3333/v1/auth/phone/otp/verify -H "Content-Type: application/json" -d '{"phone": "+2250700000101", "otp": "{}"}'
    router.post('/phone/otp/send', [AuthController, 'sendPhoneOtp']) // login   request
    router.post('/phone/otp/verify', [AuthController, 'verifyPhoneOtp']) // login   confirm

    // Test SMS route
    router.post('/test/sms', async ({ request, response }) => {
        const { phone, message } = request.only(['phone', 'message'])
        if (!phone || !message) {
            return response.badRequest({ message: 'phone and message are required' })
        }
        const smsService = (await import('#services/sms_service')).default
        const sent = await smsService.send({ to: phone, content: message })
        return response.ok({ sent, message: sent ? 'SMS sent successfully' : 'Failed to send SMS' })
    })
    // Public config (Google Maps Key, etc)
    router.get('/config', [AuthController, 'getPublicConfig'])
}).prefix('/v1/auth')

router.group(() => {
    // API Key Management (Root/Admin/User action)
    router.post('/auth/api-keys', [AuthController, 'generateApiKey'])
    router.get('/auth/api-keys/:userId', [AuthController, 'listApiKeys'])
    router.delete('/auth/api-keys/:keyId', [AuthController, 'deleteApiKey'])

    // User Profile
    router.get('/auth/me', [AuthController, 'me'])
    router.put('/auth/me', [AuthController, 'updateProfile'])
    router.put('/auth/fcm-token', [AuthController, 'updateFcmToken'])
    router.patch('/profile', [AuthController, 'updateFcmToken']) // Compatibility with d_driver
})
    .prefix('/v1')
    .use(middleware.auth())
