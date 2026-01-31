import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

export class AdminService {
    /**
     * Promote user to admin
     */
    async promoteToAdmin(currentUser: User, userId: string) {
        if (!currentUser.isAdmin) {
            throw new Error('Only admins can promote users to admin')
        }

        const trx = await db.transaction()
        try {
            const targetUser = await User.query({ client: trx }).where('id', userId).forUpdate().firstOrFail()

            if (targetUser.isAdmin) {
                await trx.commit()
                throw new Error('User is already an admin')
            }

            targetUser.isAdmin = true
            await targetUser.useTransaction(trx).save()
            await trx.commit()

            return targetUser
        } catch (error) {
            await trx.rollback()
            throw error
        }
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
