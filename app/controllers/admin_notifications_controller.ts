import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import User from '#models/user'
import NotificationService from '#services/notification_service'

const sendTestPushValidator = vine.compile(
    vine.object({
        phone: vine.string().trim().regex(/^\+[0-9]{8,15}$/),
        title: vine.string().trim().minLength(2).maxLength(120).optional(),
        body: vine.string().trim().minLength(2).maxLength(300).optional(),
    })
)

export default class AdminNotificationsController {
    async sendTestPush({ request, response }: HttpContext) {
        try {
            const { phone, title, body } = await request.validateUsing(sendTestPushValidator)

            const user = await User.query().where('phone', phone).first()
            if (!user) {
                return response.notFound({ message: `User not found for phone ${phone}` })
            }

            await NotificationService.sendTestPush(user, {
                title,
                body,
                data: {
                    phone,
                    source: 'admin_test_route',
                }
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
}
