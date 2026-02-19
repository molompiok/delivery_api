import type { HttpContext } from '@adonisjs/core/http'
import walletBridgeService from '#services/wallet_bridge_service'
import { inject } from '@adonisjs/core'
import User from '#models/user'
import CompanyDriverSetting from '#models/company_driver_setting'

@inject()
export default class DriverPaymentsController {

    /**
     * Liste tous les wallets accessibles par le driver (Personnel + Entreprises)
     */
    public async listWallets({ auth, response }: HttpContext) {
        try {
            const user = auth.user as User
            const wallets = []

            // 1. Wallet personnel
            if (user.walletId) {
                try {
                    const personalWallet = await walletBridgeService.getWallet(user.walletId)
                    wallets.push({
                        ...personalWallet,
                        label: 'Mon Portefeuille',
                        isPersonal: true
                    })
                } catch (e) {
                    console.error('Failed to fetch personal wallet', e)
                }
            }

            // 2. Wallets liés aux entreprises (ETP/IDEP)
            const relations = await CompanyDriverSetting.query()
                .where('driverId', user.id)
                .whereIn('status', ['ACCEPTED', 'ACCESS_ACCEPTED'])
                .preload('company')

            for (const rel of relations) {
                if (rel.walletId) {
                    try {
                        const companyWallet = await walletBridgeService.getWallet(rel.walletId)
                        wallets.push({
                            ...companyWallet,
                            label: rel.company.name,
                            isPersonal: false,
                            relationId: rel.id
                        })
                    } catch (e) {
                        console.error(`Failed to fetch wallet for relation ${rel.id}`, e)
                    }
                }
            }

            return response.ok(wallets)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Récupère l'historique combiné ou filtré
     */
    public async getTransactions({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const { wallet_id, start_date, end_date, category, limit, page } = request.qs()

            const accessibleWalletIds = await this.getAccessibleWalletIds(user)
            let targetWalletIds: string[] = []

            if (wallet_id) {
                const requestedIds = Array.isArray(wallet_id) ? wallet_id : [wallet_id]
                targetWalletIds = requestedIds.filter(id => accessibleWalletIds.includes(id))
                if (targetWalletIds.length === 0) {
                    return response.forbidden({ message: 'No accessible wallets found in request' })
                }
            } else {
                targetWalletIds = accessibleWalletIds
            }

            const transactions = await walletBridgeService.getMultiLedgers({
                walletIds: targetWalletIds,
                startDate: start_date,
                endDate: end_date,
                category,
                limit: limit ? parseInt(limit) : 50,
                page: page ? parseInt(page) : 1
            })

            return response.ok(transactions)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Génère un lien de dépôt (rechargement)
     */
    public async deposit({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const { walletId, amount, description, successUrl, errorUrl } = request.body()

            const accessibleIds = await this.getAccessibleWalletIds(user)
            if (!accessibleIds.includes(walletId)) {
                return response.forbidden({ message: 'You do not have access to this wallet' })
            }

            const result = await walletBridgeService.deposit({
                walletId,
                amount,
                description: description || `Rechargement par ${user.fullName}`,
                successUrl: successUrl || 'https://sublymus.com/success',
                errorUrl: errorUrl || 'https://sublymus.com/error'
            })

            return response.ok(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Initie un retrait (Payout) vers Wave
     */
    public async payout({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const { walletId, amount, recipientPhone, recipientName } = request.body()

            const accessibleIds = await this.getAccessibleWalletIds(user)
            if (!accessibleIds.includes(walletId)) {
                return response.forbidden({ message: 'You do not have access to this wallet' })
            }

            const res = await walletBridgeService.sendPayout({
                walletId,
                amount,
                recipientPhone: recipientPhone || user.phone || '',
                recipientName: recipientName || user.fullName || 'Driver',
                externalReference: `payout_${user.id}_${Date.now()}`,
                label: `Retrait driver ${user.fullName}`
            })

            return response.ok(res)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Transfert entre wallets du driver
     */
    public async transfer({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const { fromWalletId, toWalletId, amount, label } = request.body()

            const accessibleIds = await this.getAccessibleWalletIds(user)
            if (!accessibleIds.includes(fromWalletId) || !accessibleIds.includes(toWalletId)) {
                return response.forbidden({ message: 'Access denied to one of the wallets' })
            }

            const res = await walletBridgeService.transfer({
                from_wallet_id: fromWalletId,
                to_wallet_id: toWalletId,
                amount,
                label: label || 'Transfert inter-portefeuille',
                external_reference: `transfer_${user.id}_${Date.now()}`
            })

            return response.ok(res)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Stats pour un wallet ou globales
     */
    public async stats({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const { walletId, startDate, endDate } = request.qs()

            if (walletId) {
                const accessibleIds = await this.getAccessibleWalletIds(user)
                if (!accessibleIds.includes(walletId)) {
                    return response.forbidden({ message: 'Access denied' })
                }
                const stats = await walletBridgeService.getWalletStats(walletId, { startDate, endDate })
                return response.ok(stats)
            } else {
                // Pour les stats globales, wave-api /stats utilise le ManagerId.
                // Ici, c'est plus complexe car le driver n'est pas un Manager au sens wave-api.
                // On pourrait agréger les stats de tous ses wallets.
                // Pour simplifier on va juste interdire le global sans walletId pour l'instant ou renvoyer une erreur explicite.
                return response.badRequest({ message: 'walletId is required for driver stats' })
            }
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Privé: Récupère la liste des IDs de wallets auxquels le driver a accès
     */
    private async getAccessibleWalletIds(user: User): Promise<string[]> {
        const ids: string[] = []
        if (user.walletId) ids.push(user.walletId)

        const relations = await CompanyDriverSetting.query()
            .where('driverId', user.id)
            .whereIn('status', ['ACCEPTED', 'ACCESS_ACCEPTED'])
            .select('walletId')

        relations.forEach(r => {
            if (r.walletId) ids.push(r.walletId)
        })

        return ids
    }
}
