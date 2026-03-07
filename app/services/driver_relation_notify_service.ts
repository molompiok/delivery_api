import User from '#models/user'
import WsService from '#services/ws_service'
import NotificationService from '#services/notification_service'

export interface DriverRelationNotifyInput {
    driverId?: string | null
    companyId?: string | null
    relationId?: string | null
    scope: 'INVITATION' | 'ASSIGNMENT' | 'DOCUMENT' | 'SCHEDULE'
    action: string
    message: string
    entity?: Record<string, any>
    push?: {
        enabled?: boolean
        title?: string
        body?: string
        type?: string
        data?: Record<string, any>
    }
}

class DriverRelationNotifyService {
    public async dispatch(input: DriverRelationNotifyInput) {
        const payload = {
            scope: input.scope,
            action: input.action,
            message: input.message,
            relationId: input.relationId || null,
            driverId: input.driverId || null,
            companyId: input.companyId || null,
            entity: input.entity || null,
        }

        WsService.notifyDriverRelationUpdate(input.driverId, input.companyId, payload)

        const pushEnabled = input.push?.enabled !== false
        if (!pushEnabled || !input.driverId) return

        const driver = await User.find(input.driverId)
        if (!driver) return

        const pushType = input.push?.type || `DRIVER_${input.scope}_UPDATED`
        const pushTitle = input.push?.title || 'Mise a jour'
        const pushBody = input.push?.body || input.message

        await NotificationService.sendDriverManagementAlert(driver, {
            title: pushTitle,
            body: pushBody,
            type: pushType,
            data: {
                ...payload,
                ...(input.push?.data || {}),
            },
        })
    }
}

export default new DriverRelationNotifyService()
