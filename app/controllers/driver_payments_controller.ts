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
                    console.log(`[DriverPayments] Fetching personal wallet ${user.walletId} for user ${user.id}`)
                    const walletData = await walletBridgeService.getWallet(user.walletId) as any

                    const transformed = {
                        ...walletData,
                        name: walletData.ownerName || walletData.owner_name || 'Mon Portefeuille',
                        owner_name: walletData.ownerName || walletData.owner_name || 'Mon Portefeuille',
                        ownerName: walletData.ownerName || walletData.owner_name || 'Mon Portefeuille',
                        label: walletData.ownerName || walletData.owner_name || 'Mon Portefeuille',
                        balance_available: walletData.balance_available ?? walletData.balanceAvailable,
                        balance_accounting: walletData.balance_accounting ?? walletData.balanceAccounting,
                        balanceAvailable: walletData.balance_available ?? walletData.balanceAvailable,
                        balanceAccounting: walletData.balance_accounting ?? walletData.balanceAccounting,
                        wallet_type: 'PERSONAL',
                        walletType: 'PERSONAL',
                        isPersonal: true
                    }
                    console.log(`[DriverPayments] Personal wallet found: ${transformed.owner_name} (${transformed.balance_available} F)`)
                    wallets.push(transformed)
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
                        console.log(`[DriverPayments] Fetching company wallet ${rel.walletId} for relation ${rel.id}`)
                        const walletData = await walletBridgeService.getWallet(rel.walletId) as any
                        const transformed = {
                            ...walletData,
                            name: rel.company.name,
                            owner_name: rel.company.name,
                            ownerName: rel.company.name,
                            label: rel.company.name,
                            balance_available: walletData.balance_available ?? walletData.balanceAvailable,
                            balance_accounting: walletData.balance_accounting ?? walletData.balanceAccounting,
                            balanceAvailable: walletData.balance_available ?? walletData.balanceAvailable,
                            balanceAccounting: walletData.balance_accounting ?? walletData.balanceAccounting,
                            wallet_type: 'COMPANY',
                            walletType: 'COMPANY',
                            isPersonal: false,
                            relationId: rel.id
                        }
                        console.log(`[DriverPayments] Company wallet found: ${transformed.name}`)
                        wallets.push(transformed)
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

            // Transformation pour assurer la compatibilité avec le frontend (snake_case)
            if (transactions.data) {
                transactions.data = transactions.data.map((tx: any) => {
                    if (tx.wallet) {
                        tx.wallet.owner_name = tx.wallet.ownerName || tx.wallet.owner_name
                    }
                    return tx
                })
            }

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
            const body = request.body()
            const walletId = body.walletId || body.wallet_id
            const amount = body.amount
            const description = body.description
            const successUrl = body.successUrl || body.success_url
            const errorUrl = body.errorUrl || body.error_url

            if (!walletId) {
                return response.badRequest({ message: 'walletId (or wallet_id) is required' })
            }

            const accessibleIds = await this.getAccessibleWalletIds(user)
            if (!accessibleIds.includes(walletId)) {
                console.warn(`[DriverPayments] Deposit - User ${user.id} tried to access unauthorized wallet ${walletId}`)
                return response.forbidden({ message: 'You do not have access to this wallet' })
            }

            console.log(`[DriverPayments] Deposit - Request accepted for user ${user.id}`, { walletId, amount, description })

            const result = await walletBridgeService.deposit({
                walletId,
                amount,
                description: description || `Rechargement par ${user.fullName}`,
                successUrl: successUrl || 'https://sublymus.com/success',
                errorUrl: errorUrl || 'https://sublymus.com/error'
            })

            console.log(`[DriverPayments] Deposit - Success`, result)

            // Enrichissement pour compatibilité frontend (tout-terrain)
            const enrichedResult = {
                ...result,
                data: {
                    ...result.data,
                    waveCheckoutUrl: result.data.wave_checkout_url,
                    paymentUrl: result.data.wave_checkout_url,
                    payment_url: result.data.wave_checkout_url
                }
            }

            return response.ok(enrichedResult)
        } catch (error: any) {
            console.error(`[DriverPayments] Deposit - Error`, error)
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Initie un retrait (Payout) vers Wave
     */
    public async payout({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const body = request.body()
            const walletId = body.walletId || body.wallet_id
            const amount = body.amount
            const recipientPhone = body.recipientPhone || body.recipient_phone
            const recipientName = body.recipientName || body.recipient_name

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
            const body = request.body()
            const fromWalletId = body.fromWalletId || body.from_wallet_id
            const toWalletId = body.toWalletId || body.to_wallet_id
            const amount = body.amount
            const label = body.label

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
                    console.warn(`[DriverPayments] Unauthorized stats request for wallet ${walletId} by user ${user.id}`)
                    return response.forbidden({ message: 'Access denied' })
                }
                const stats = await walletBridgeService.getWalletStats(walletId, { startDate, endDate }) as any

                // Transformation du wallet inclu dans les stats
                if (stats.wallet) {
                    const isPersonal = user.walletId === walletId
                    stats.wallet = {
                        ...stats.wallet,
                        name: stats.wallet.ownerName || stats.wallet.owner_name || (isPersonal ? 'Mon Portefeuille' : 'Portefeuille Partenaire'),
                        owner_name: stats.wallet.ownerName || stats.wallet.owner_name || (isPersonal ? 'Mon Portefeuille' : 'Portefeuille Partenaire'),
                        ownerName: stats.wallet.ownerName || stats.wallet.owner_name || (isPersonal ? 'Mon Portefeuille' : 'Portefeuille Partenaire'),
                        label: stats.wallet.ownerName || stats.wallet.owner_name || (isPersonal ? 'Mon Portefeuille' : 'Portefeuille Partenaire'),
                        balance_available: stats.wallet.balance_available ?? stats.wallet.balanceAvailable,
                        balance_accounting: stats.wallet.balance_accounting ?? stats.wallet.balanceAccounting,
                        balanceAvailable: stats.wallet.balance_available ?? stats.wallet.balanceAvailable,
                        balanceAccounting: stats.wallet.balance_accounting ?? stats.wallet.balanceAccounting,
                        wallet_type: isPersonal ? 'PERSONAL' : 'COMPANY',
                        walletType: isPersonal ? 'PERSONAL' : 'COMPANY'
                    }
                }

                console.log(`[DriverPayments] Stats returned for wallet ${walletId}`)
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
