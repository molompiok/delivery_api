import type { HttpContext } from '@adonisjs/core/http'
import walletBridgeService from '#services/wallet_bridge_service'
import WalletProvisioningService from '#services/wallet_provisioning_service'
import { inject } from '@adonisjs/core'
import User from '#models/user'

@inject()
export default class ClientPaymentsController {

    /**
     * Récupère le wallet du client
     */
    public async getWallet({ auth, response }: HttpContext) {
        try {
            const user = auth.user as User
            await WalletProvisioningService.ensureUserWallet(user)

            if (!user.walletId) {
                return response.badRequest({ message: 'No wallet found for this client' })
            }

            const walletData = await walletBridgeService.getWallet(user.walletId) as any

            // Transformation pour compatibilité
            const transformed = {
                ...walletData,
                name: walletData.ownerName || walletData.owner_name || 'Compte Personnel',
                balance_available: walletData.balance_available ?? walletData.balanceAvailable,
                balance_accounting: walletData.balance_accounting ?? walletData.balanceAccounting,
                wallet_type: 'CLIENT',
                isPersonal: true
            }

            return response.ok(transformed)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Récupère l'historique des transactions du client
     */
    public async getTransactions({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const { start_date, end_date, category, limit, page } = request.qs()

            if (!user.walletId) {
                await WalletProvisioningService.ensureUserWallet(user)
            }

            if (!user.walletId) {
                return response.ok({ data: [], meta: { total: 0 } })
            }

            const transactions = await walletBridgeService.getMultiLedgers({
                walletIds: [user.walletId],
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
     * Génère un lien de dépôt (rechargement via Wave)
     */
    public async deposit({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const body = request.body()
            const amount = body.amount
            const successUrl = body.successUrl || body.success_url
            const errorUrl = body.errorUrl || body.error_url

            if (!user.walletId) {
                await WalletProvisioningService.ensureUserWallet(user)
            }

            if (!user.walletId) {
                return response.badRequest({ message: 'No wallet found for this client' })
            }

            const result = await walletBridgeService.deposit({
                walletId: user.walletId,
                amount,
                description: `Rechargement portefeuille client ${user.fullName || user.phone}`,
                successUrl: successUrl || 'https://sublymus.com/payment/success',
                errorUrl: errorUrl || 'https://sublymus.com/payment/error'
            })

            // Enrichissement pour le frontend Flutter
            const waveUrl = result.data.wave_checkout_url || result.data.waveCheckoutUrl || result.data.paymentUrl

            return response.ok({
                ...result,
                checkout_url: waveUrl,
                checkoutUrl: waveUrl
            })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Stats simplifiées pour le client
     */
    public async stats({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const qs = request.qs()
            const startDate = qs.startDate || qs.start_date
            const endDate = qs.endDate || qs.end_date

            if (!user.walletId) {
                await WalletProvisioningService.ensureUserWallet(user)
            }

            if (!user.walletId) {
                return response.badRequest({ message: 'No wallet found' })
            }

            const stats = await walletBridgeService.getWalletStats(user.walletId, { startDate, endDate })
            return response.ok(stats)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Transfert vers un autre numéro (Wallet -> Wallet)
     */
    public async transfer({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const { amount, recipientPhone, label } = request.body()

            if (!user.walletId) {
                await WalletProvisioningService.ensureUserWallet(user)
            }

            if (!user.walletId) {
                return response.badRequest({ message: 'No wallet found' })
            }

            // Pour un transfert vers un numéro, on doit d'abord identifier le wallet de destination
            const recipientWalletId = await walletBridgeService.resolveWalletIdByPhone(recipientPhone)
            if (!recipientWalletId) {
                return response.badRequest({ message: 'Destinataire introuvable ou n\'a pas de portefeuille Wave' })
            }

            const result = await walletBridgeService.transfer({
                from_wallet_id: user.walletId,
                to_wallet_id: recipientWalletId,
                amount,
                label: label || `Transfert de ${user.fullName || user.phone}`,
                external_reference: `transfer_client_${user.id}_${Date.now()}`
            })

            return response.ok(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Retrait vers son propre numéro Wave (Payout)
     */
    public async payout({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const { amount } = request.body()

            if (!user.walletId) {
                await WalletProvisioningService.ensureUserWallet(user)
            }

            if (!user.walletId) {
                return response.badRequest({ message: 'No wallet found' })
            }

            const result = await walletBridgeService.sendPayout({
                walletId: user.walletId,
                amount,
                recipientPhone: user.phone || '',
                recipientName: user.fullName || 'Client',
                externalReference: `payout_client_${user.id}_${Date.now()}`,
                label: `Retrait client ${user.fullName}`
            })

            return response.ok(result)
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }

    /**
     * Estimation des frais de retrait
     */
    public async estimatePayout({ auth, request, response }: HttpContext) {
        try {
            const user = auth.user as User
            const { amount } = request.body()

            if (!user.walletId) {
                return response.badRequest({ message: 'No wallet found' })
            }

            const estimate = await walletBridgeService.estimatePayoutFee({
                amount: Number(amount),
                walletId: user.walletId
            })

            return response.ok({ data: estimate })
        } catch (error: any) {
            return response.badRequest({ message: error.message })
        }
    }
}
