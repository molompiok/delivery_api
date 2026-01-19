import User from '#models/user'

export class AdminService {
    /**
     * Promote user to admin
     */
    async promoteToAdmin(currentUser: User, userId: string) {
        if (!currentUser.isAdmin) {
            throw new Error('Only admins can promote users to admin')
        }

        const targetUser = await User.findOrFail(userId)

        if (targetUser.isAdmin) {
            throw new Error('User is already an admin')
        }

        targetUser.isAdmin = true
        await targetUser.save()

        return targetUser
    }

    /**
     * List all admins
     */
    async listAdmins(currentUser: User) {
        if (!currentUser.isAdmin) {
            throw new Error('Only admins can view admin list')
        }

        return await User.query().where('isAdmin', true).orderBy('createdAt', 'asc')
    }
}

export default new AdminService()
