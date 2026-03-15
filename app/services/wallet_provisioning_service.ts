import User from '#models/user'
import Company from '#models/company'
import CompanyDriverSetting from '#models/company_driver_setting'
import DriverSetting from '#models/driver_setting'
import walletBridgeService from '#services/wallet_bridge_service'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

type WalletEntityType = 'DRIVER' | 'VENDOR' | 'CLIENT' | 'PLATFORM' | 'COMPANY' | 'COMPANY_DRIVER'

class WalletProvisioningService {
    private readonly disallowedOwnerNameValues = [
        'ajouter un nom',
        'add a name',
        'add name',
        'nom complet',
        'full name',
    ]

    private isWalletBridgeConfigured(): boolean {
        return Boolean(env.get('WAVE_API_KEY', '') && env.get('WAVE_MANAGER_ID', ''))
    }

    private normalizeOwnerName(value?: string | null): string | null {
        const trimmed = value?.trim()
        if (!trimmed) return null

        const lowered = trimmed.toLowerCase()
        const isDisallowed = this.disallowedOwnerNameValues.some((bad) => lowered === bad)
        if (isDisallowed) return null

        return trimmed
    }

    private resolveUserOwnerName(user: User): string {
        return (
            this.normalizeOwnerName(user.fullName) ||
            this.normalizeOwnerName(user.phone) ||
            `User ${user.id}`
        )
    }

    private async safeAutoAssign(params: {
        ownerId: string
        entityType: WalletEntityType
        ownerName?: string
        ownerWavePhone?: string
    }): Promise<string | null> {
        if (!this.isWalletBridgeConfigured()) {
            logger.warn(
                { ownerId: params.ownerId, entityType: params.entityType },
                '[WalletProvisioning] Wallet bridge not configured, skipping auto-assign'
            )
            return null
        }

        try {
            return await walletBridgeService.autoAssignWallet(
                params.ownerId,
                params.entityType,
                params.ownerName,
                params.ownerWavePhone
            )
        } catch (error) {
            logger.error(
                {
                    ownerId: params.ownerId,
                    entityType: params.entityType,
                    error,
                },
                '[WalletProvisioning] Auto-assign failed'
            )
            return null
        }
    }

    async ensureUserWallet(
        input: User | string,
        options: { entityType?: WalletEntityType } = {}
    ): Promise<string | null> {
        const user = typeof input === 'string' ? await User.find(input) : input
        if (!user) return null
        if (user.walletId) {
            await this.syncUserWalletOwnerName(user)
            return user.walletId
        }

        const entityType = options.entityType || 'CLIENT'
        const ownerName = this.resolveUserOwnerName(user)
        const walletId = await this.safeAutoAssign({
            ownerId: user.id,
            entityType,
            ownerName,
        })

        if (!walletId) return null

        const fresh = await User.find(user.id)
        if (!fresh) return null
        if (!fresh.walletId) {
            fresh.walletId = walletId
            await fresh.save()
        }

        user.walletId = fresh.walletId
        return fresh.walletId
    }

    async syncUserWalletOwnerName(input: User | string): Promise<void> {
        const user = typeof input === 'string' ? await User.find(input) : input
        if (!user || !user.walletId) return
        if (!this.isWalletBridgeConfigured()) return

        const targetOwnerName = this.resolveUserOwnerName(user)
        if (!targetOwnerName) return

        try {
            const wallet = await walletBridgeService.getWallet(user.walletId)
            const currentOwnerName = wallet.ownerName?.trim() || ''
            if (currentOwnerName !== targetOwnerName) {
                await walletBridgeService.updateWallet(user.walletId, {
                    ownerName: targetOwnerName,
                })
            }
        } catch (error) {
            logger.warn(
                { userId: user.id, walletId: user.walletId, error },
                '[WalletProvisioning] Failed to sync wallet owner name'
            )
        }
    }

    async ensureCompanyWallet(input: Company | string): Promise<string | null> {
        const company = typeof input === 'string' ? await Company.find(input) : input
        if (!company) return null
        if (company.walletId) return company.walletId

        const walletId = await this.safeAutoAssign({
            ownerId: company.id,
            entityType: 'COMPANY',
            ownerName: company.name,
        })

        if (!walletId) return null

        const fresh = await Company.find(company.id)
        if (!fresh) return null
        if (!fresh.walletId) {
            fresh.walletId = walletId
            await fresh.save()
        }

        company.walletId = fresh.walletId
        return fresh.walletId
    }

    async ensureCompanyDriverWallet(input: CompanyDriverSetting | string): Promise<string | null> {
        const relation = typeof input === 'string'
            ? await CompanyDriverSetting.query().where('id', input).preload('company').preload('driver').first()
            : input

        if (!relation) return null
        if (relation.walletId) return relation.walletId

        if (!relation.$preloaded.company) {
            await relation.load('company')
        }
        if (!relation.$preloaded.driver) {
            await relation.load('driver')
        }

        const ownerName = `${relation.company.name} • ${relation.driver.fullName || relation.driver.phone || relation.driverId}`
        const walletId = await this.safeAutoAssign({
            ownerId: relation.id,
            entityType: 'COMPANY_DRIVER',
            ownerName,
        })

        if (!walletId) return null

        const fresh = await CompanyDriverSetting.find(relation.id)
        if (!fresh) return null
        if (!fresh.walletId) {
            fresh.walletId = walletId
            await fresh.save()
        }

        relation.walletId = fresh.walletId
        return fresh.walletId
    }

    async ensureDriverProfileWallet(input: DriverSetting | string): Promise<string | null> {
        const profile = typeof input === 'string'
            ? await DriverSetting.query().where('id', input).preload('user').first()
            : input

        if (!profile) return null
        if (profile.walletId) return profile.walletId

        if (!profile.$preloaded.user) {
            await profile.load('user')
        }

        const ownerName = `${this.resolveUserOwnerName(profile.user)} (Pro)`
        const walletId = await this.safeAutoAssign({
            ownerId: profile.id,
            entityType: 'DRIVER',
            ownerName,
        })

        if (!walletId) return null

        const fresh = await DriverSetting.find(profile.id)
        if (!fresh) return null
        if (!fresh.walletId) {
            fresh.walletId = walletId
            await fresh.save()
        }

        profile.walletId = fresh.walletId
        return fresh.walletId
    }

    /**
     * Best-effort repair for existing data:
     * - User wallet
     * - Missing company-driver wallets for accepted relations
     * - Active managed company wallet (if any)
     */
    async ensureDriverWalletGraph(user: User): Promise<void> {
        await this.ensureUserWallet(user)

        const profile = await DriverSetting.query().where('userId', user.id).first()
        if (profile) {
            await this.ensureDriverProfileWallet(profile)
        }

        const missingRelationWallets = await CompanyDriverSetting.query()
            .where('driverId', user.id)
            .whereIn('status', ['ACCEPTED', 'ACCESS_ACCEPTED'])
            .whereNull('walletId')
            .preload('company')
            .preload('driver')

        for (const relation of missingRelationWallets) {
            await this.ensureCompanyDriverWallet(relation)
        }

        const activeCompanyId = user.currentCompanyManaged || user.companyId
        if (!activeCompanyId) return

        const company = await Company.query()
            .where('id', activeCompanyId)
            .whereNull('walletId')
            .first()

        if (company) {
            await this.ensureCompanyWallet(company)
        }
    }
}

export default new WalletProvisioningService()
