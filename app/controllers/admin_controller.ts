import type { HttpContext } from '@adonisjs/core/http'
import AdminService from '#services/admin_service'

export default class AdminController {
    /**
     * Promote a user to admin (only accessible by existing admins)
     */
    public async promoteToAdmin({ auth, request, response }: HttpContext) {
        try {
            const currentUser = auth.user!
            const { userId } = request.only(['userId'])
            const targetUser = await AdminService.promoteToAdmin(currentUser, userId)

            return response.ok({
                message: 'User promoted to admin successfully',
                user: {
                    id: targetUser.id,
                    phone: targetUser.phone,
                    email: targetUser.email,
                    isAdmin: targetUser.isAdmin,
                },
            })
        } catch (error: any) {
            if (error.message.includes('Only admins')) {
                return response.forbidden({ message: error.message })
            }
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * List all admin users
     */
    public async listAdmins({ auth, response }: HttpContext) {
        try {
            const currentUser = auth.user!
            const admins = await AdminService.listAdmins(currentUser)

            return response.ok(
                admins.map((admin) => ({
                    id: admin.id,
                    phone: admin.phone,
                    email: admin.email,
                    fullName: admin.fullName,
                    createdAt: admin.createdAt,
                }))
            )
        } catch (error: any) {
            return response.forbidden({ message: error.message })
        }
    }
}
