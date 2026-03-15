import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import { isWaveLedgerCategory } from '#constants/wave_ledger_categories'
import type { DeliveryLedgerCategory, WaveLedgerCategory } from '#constants/wave_ledger_categories'

/**
 * WalletBridgeService
 * 
 * Pont HTTP entre delivery-api et wave-api.
 * Toutes les opérations financières passent par ce service.
 */

interface WaveApiConfig {
    baseUrl: string
    apiKey: string
    managerId: string
}

interface CreateWalletPayload {
    ownerId: string
    ownerName?: string
    ownerWavePhone?: string
    entityType: 'DRIVER' | 'VENDOR' | 'CLIENT' | 'PLATFORM' | 'COMPANY' | 'COMPANY_DRIVER'
    currency?: string
    overdraftLimit?: number
}

interface WalletResponse {
    id: string
    ownerId: string
    ownerName: string | null
    entityType: string
    balanceAccounting: number
    balanceAvailable: number
    currency: string
    isLocked: boolean
}

interface UpdateWalletPayload {
    ownerName?: string
    ownerWavePhone?: string
}

interface BalanceResponse {
    id: string
    balance: number
    available_balance: number
    pending_balance: number
    currency: string
    owner_id: string
    entity_type: string
}

interface SplitConfig {
    wallet_id: string
    amount: number
    category: DeliveryLedgerCategory
    label: string
    external_reference?: string
    release_delay_hours?: number
    allow_early_release?: boolean
}

interface PaymentIntentResponse {
    payment_intent_id: string
    status: string
    wave_checkout_url: string | null
    amount: number
    currency: string
    external_reference?: string
    expires_at?: string | null
}

interface InternalIntentPayload {
    payer_wallet_id: string
    amount: number
    currency?: string
    description?: string
    external_reference?: string
    splits: SplitConfig[]
}

interface InternalIntentResponse {
    internal_payment_intent_id: string
    status: string
    amount: number
    currency: string
}

interface TransferPayload {
    from_wallet_id: string
    to_wallet_id: string
    amount: number
    category?: DeliveryLedgerCategory
    label?: string
    external_reference?: string
}

interface ReleasePayload {
    wallet_id: string
    amount: number
    category?: DeliveryLedgerCategory
    label?: string
    external_reference?: string
}

interface RefundPayload {
    wallet_id: string
    amount: number
    reason?: string
    external_reference?: string
}

interface StatsResponse {
    income: number
    expense: number
    net: number
    transaction_count: number
    by_category?: Record<string, number>
}

interface PayoutEstimateResponse {
    net_amount: number
    fee_bps: number
    estimated_fee: number
    total_debit: number
    wallet_id?: string
    balance_available?: number
    can_payout?: boolean
    missing_amount?: number
}

class WalletBridgeService {
    private config: WaveApiConfig

    constructor() {
        this.config = {
            baseUrl: env.get('WAVE_API_URL', 'http://localhost:3335'),
            apiKey: env.get('WAVE_API_KEY', ''),
            managerId: env.get('WAVE_MANAGER_ID', ''),
        }
    }

    private get headers() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
            'X-Manager-Id': this.config.managerId,
        }
    }

    /**
     * Map delivery-api categories to wave-api supported enums
     */
    private mapCategory(category?: string): WaveLedgerCategory {
        if (!category) return 'ADJUSTMENT'

        const normalized = category.toUpperCase()

        const aliases: Record<string, WaveLedgerCategory> = {
            ORDER_PAYMENT: 'ORDER_PAYMENT',
            SERVICE_PAYMENT: 'SERVICE_PAYMENT',
            COMMISSION: 'COMMISSION',
            DEPOSIT: 'DEPOSIT',
            PAYOUT: 'PAYOUT',
            REFUND: 'REFUND',
            ADJUSTMENT: 'ADJUSTMENT',
            SUBSCRIPTION: 'SUBSCRIPTION',
            TRANSFER: 'TRANSFER',
            SALARY: 'SALARY',
            DRIVER_PAYMENT: 'DRIVER_PAYMENT',
            COMPANY_COMMISSION: 'COMPANY_COMMISSION',
            PLATFORM_COMMISSION: 'PLATFORM_COMMISSION',
            COD_SETTLEMENT: 'COD_SETTLEMENT',
            RELEASE: 'RELEASE',
            SUBSCRIPTION_FEE: 'SUBSCRIPTION_FEE',
        }

        const mapped = aliases[normalized] || normalized
        if (isWaveLedgerCategory(mapped)) {
            return mapped
        }

        logger.warn({ category }, '[WalletBridge] Unknown category mapped to ADJUSTMENT')
        return 'ADJUSTMENT'
    }

    private async request<T>(method: string, path: string, body?: any): Promise<T> {
        const url = `${this.config.baseUrl}/v1${path}`
        const maxRetries = 3
        let lastError: any

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger.info({ method, url, attempt }, '[WalletBridge] Requesting')

                const response = await fetch(url, {
                    method,
                    headers: this.headers,
                    body: body ? JSON.stringify(body) : undefined,
                })

                const data = await response.json() as any

                if (!response.ok) {
                    logger.error({ status: response.status, data, url }, '[WalletBridge] API error')
                    throw new Error(data.message || `Wave API error: ${response.status}`)
                }

                logger.debug({ status: response.status, data }, '[WalletBridge] Response')
                return data
            } catch (error: any) {
                lastError = error
                const msg = error.message.toLowerCase()

                // Retry only on network/timeout errors
                if (msg.includes('fetch failed') || msg.includes('timeout') || msg.includes('etimedout')) {
                    logger.warn({ url, attempt, error: error.message }, '[WalletBridge] Network failure, retrying...')
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 500 * attempt))
                        continue
                    }
                }
                throw error
            }
        }
        throw lastError
    }

    // ─── WALLETS ───────────────────────────────────────────

    /**
     * Créer un wallet dans wave-api pour un owner
     */
    async createWallet(payload: CreateWalletPayload): Promise<WalletResponse> {
        const data = await this.request<WalletResponse>('POST', '/wallets', {
            owner_id: payload.ownerId,
            owner_name: payload.ownerName,
            owner_wave_phone: payload.ownerWavePhone,
            entity_type: payload.entityType,
            currency: payload.currency || 'XOF',
            overdraft_limit: payload.overdraftLimit || 0,
        })
        return data
    }

    /**
     * Récupérer le wallet principal du manager (PLATFORM)
     */
    async getMainWallet(): Promise<WalletResponse> {
        return this.request<WalletResponse>('GET', '/wallets/main')
    }

    /**
     * Récupérer un wallet par ID
     */
    async getWallet(walletId: string): Promise<WalletResponse> {
        return this.request<WalletResponse>('GET', `/wallets/${walletId}`)
    }

    /**
     * Mettre à jour les métadonnées d'un wallet
     */
    async updateWallet(walletId: string, payload: UpdateWalletPayload): Promise<WalletResponse> {
        return this.request<WalletResponse>('PATCH', `/wallets/${walletId}`, {
            owner_name: payload.ownerName,
            owner_wave_phone: payload.ownerWavePhone,
        })
    }

    /**
     * Récupérer le solde d'un wallet
     */
    async getBalance(walletId: string): Promise<BalanceResponse> {
        return this.request<BalanceResponse>('GET', `/wallets/${walletId}/balance`)
    }

    /**
     * Résoudre un wallet_id par numéro de téléphone Wave
     */
    async resolveWalletIdByPhone(phone: string): Promise<string | null> {
        try {
            const data = await this.request<{ walletId: string }>('GET', `/wallets/by-phone/${phone}`)
            return data.walletId
        } catch (error) {
            logger.warn({ phone, error: error.message }, '[WalletBridge] Could not resolve wallet by phone')
            return null
        }
    }

    // ─── PAIEMENTS EXTERNES (WAVE CHECKOUT) ───────────────

    /**
     * Créer un PaymentIntent (checkout Wave externe)
     * Le client paie via Wave, et les splits distribuent les fonds aux wallets
     */
    async createPaymentIntent(params: {
        amount: number
        currency?: string
        externalReference: string
        description?: string
        successUrl: string
        errorUrl: string
        splits: SplitConfig[]
    }): Promise<PaymentIntentResponse> {
        const res = await this.request<{ data: PaymentIntentResponse }>('POST', '/checkout/complex', {
            amount: params.amount,
            currency: params.currency || 'XOF',
            external_reference: params.externalReference,
            source_system: 'DELIVERY',
            payer_id: this.config.managerId,
            description: params.description,
            success_url: params.successUrl,
            error_url: params.errorUrl,
            splits: params.splits.map(s => ({
                ...s,
                category: this.mapCategory(s.category)
            })),
        })
        return res.data
    }

    /**
     * Vérifier si un paiement a été reçu dans le ledger du manager (Platform)
     */
    async checkPaymentStatus(params: { externalId: string, internalId: string }): Promise<'COMPLETED' | 'PENDING'> {
        const platformWalletId = env.get('WAVE_PLATFORM_WALLET_ID')
        if (!platformWalletId) {
            logger.warn('[WalletBridge] WAVE_PLATFORM_WALLET_ID not configured, cannot check payment status')
            return 'PENDING'
        }

        try {
            const data = await this.getMultiLedgers({
                walletIds: [platformWalletId],
                limit: 50
            })

            const entries = data.data || []
            logger.debug({ count: entries.length, params }, '[WalletBridge] Checking ledger entries')

            const found = entries.find((l: any) => {
                const extRef = l.externalReference || l.external_reference
                const piId = l.metadata?.payment_intent_id || l.payment_intent_id

                return piId === params.externalId || extRef === params.internalId
            })

            if (found) {
                logger.info({ id: found.id, params }, '[WalletBridge] Payment found in ledger')
            }

            return found ? 'COMPLETED' : 'PENDING'
        } catch (error) {
            logger.error({ error, ...params }, '[WalletBridge] Failed to check payment status')
            return 'PENDING'
        }
    }

    // ─── TRANSFERTS INTERNES (WALLET → WALLET) ────────────

    /**
     * Créer un InternalPaymentIntent (transfert wallet-to-wallet avec splits)
     * Exécution immédiate et synchrone
     */
    async createInternalTransfer(payload: InternalIntentPayload): Promise<InternalIntentResponse> {
        const res = await this.request<{ data: InternalIntentResponse }>('POST', '/transactions/internal-intent', {
            payer_wallet_id: payload.payer_wallet_id,
            amount: payload.amount,
            currency: payload.currency || 'XOF',
            description: payload.description,
            external_reference: payload.external_reference,
            splits: payload.splits.map(s => ({
                ...s,
                category: this.mapCategory(s.category)
            })),
        })
        return res.data
    }

    /**
     * Transfert simple wallet-à-wallet (même manager)
     */
    async transfer(payload: TransferPayload): Promise<any> {
        return this.request('POST', '/transactions/transfer', {
            from_wallet_id: payload.from_wallet_id,
            to_wallet_id: payload.to_wallet_id,
            amount: payload.amount,
            category: this.mapCategory(payload.category || 'TRANSFER'),
            label: payload.label || 'Transfert interne',
            external_reference: payload.external_reference,
        })
    }

    /**
     * Libérer des fonds ON_HOLD → AVAILABLE
     */
    async releaseFunds(payload: ReleasePayload): Promise<any> {
        return this.request('POST', '/transactions/release', {
            wallet_id: payload.wallet_id,
            amount: payload.amount,
            category: this.mapCategory(payload.category || 'RELEASE'),
            label: payload.label || 'Libération de fonds',
            external_reference: payload.external_reference,
        })
    }

    /**
     * Rembourser des fonds
     */
    async refund(payload: RefundPayload): Promise<any> {
        return this.request('POST', '/transactions/refund', {
            wallet_id: payload.wallet_id,
            amount: payload.amount,
            reason: payload.reason,
            external_reference: payload.external_reference,
        })
    }

    // ─── LEDGERS (HISTORY) ───────────────────────────────

    /**
     * Récupérer les transactions de plusieurs wallets
     */
    async getMultiLedgers(params: {
        walletIds: string[]
        startDate?: string
        endDate?: string
        category?: WaveLedgerCategory
        limit?: number
        page?: number
    }): Promise<any> {
        const qs = new URLSearchParams()
        params.walletIds.forEach(id => qs.append('wallet_id', id))
        if (params.startDate) qs.append('start_date', params.startDate)
        if (params.endDate) qs.append('end_date', params.endDate)
        if (params.category) qs.append('category', params.category)
        if (params.limit) qs.append('limit', params.limit.toString())
        if (params.page) qs.append('page', params.page.toString())

        return this.request('GET', `/ledgers?${qs.toString()}`)
    }

    // ─── RETRAITS (PAYOUTS) ───────────────────────────────

    /**
     * Envoyer un payout
     */
    async sendPayout(params: {
        walletId: string
        amount: number
        recipientPhone: string
        recipientName?: string
        externalReference: string
        label: string
    }): Promise<any> {
        return this.request('POST', '/payouts', {
            wallet_id: params.walletId,
            amount: params.amount,
            recipient_phone: params.recipientPhone,
            recipient_name: params.recipientName,
            external_reference: params.externalReference,
            label: params.label,
            source_system: 'DELIVERY',
        })
    }

    async estimatePayoutFee(params: { amount: number; walletId?: string }): Promise<PayoutEstimateResponse> {
        const raw = await this.request<any>('POST', '/payouts/estimate', {
            net_amount: params.amount,
            ...(params.walletId ? { wallet_id: params.walletId } : {}),
        })

        const data = raw?.data || raw || {}
        return {
            net_amount: Number(data.net_amount || params.amount),
            fee_bps: Number(data.fee_bps || 100),
            estimated_fee: Number(data.estimated_fee || 0),
            total_debit: Number(data.total_debit || params.amount),
            wallet_id: data.wallet_id,
            balance_available: data.balance_available !== undefined ? Number(data.balance_available) : undefined,
            can_payout: data.can_payout !== undefined ? Boolean(data.can_payout) : undefined,
            missing_amount: data.missing_amount !== undefined ? Number(data.missing_amount) : undefined,
        }
    }

    // ─── STATISTIQUES ─────────────────────────────────────

    /**
     * Récupérer les stats d'un wallet
     */
    async getWalletStats(walletId: string, params: { startDate?: string, endDate?: string }): Promise<StatsResponse> {
        const qs = new URLSearchParams()
        if (params.startDate) qs.append('start_date', params.startDate)
        if (params.endDate) qs.append('end_date', params.endDate)

        return this.request<StatsResponse>('GET', `/wallets/${walletId}/stats?${qs.toString()}`)
    }

    /**
     * Récupérer les stats globales du manager
     */
    async getManagerStats(params: { startDate?: string, endDate?: string }): Promise<StatsResponse> {
        const qs = new URLSearchParams()
        if (params.startDate) qs.append('start_date', params.startDate)
        if (params.endDate) qs.append('end_date', params.endDate)

        return this.request<StatsResponse>('GET', `/stats?${qs.toString()}`)
    }

    // ─── RECHARGE (DEPOSIT) ───────────────────────────────

    /**
     * Recharger un wallet via Wave checkout
     */
    async deposit(params: {
        walletId: string
        amount: number
        description?: string
        successUrl: string
        errorUrl: string
    }): Promise<any> {
        logger.info({ walletId: params.walletId, amount: params.amount }, '[WalletBridge] Initiating deposit')
        const response = await this.request('POST', '/wallets/deposit', {
            wallet_id: params.walletId,
            amount: params.amount,
            description: params.description,
            success_url: params.successUrl,
            error_url: params.errorUrl,
        })
        logger.info({ walletId: params.walletId, amount: params.amount, response }, '[WalletBridge] Deposit response')
        return response
    }

    // ─── AUTO-ASSIGN WALLET ───────────────────────────────

    /**
     * Créer un wallet et retourner son ID
     * Appelé automatiquement à la création d'un User/Company/CDS
     */
    async autoAssignWallet(
        ownerId: string,
        entityType: CreateWalletPayload['entityType'],
        ownerName?: string,
        ownerWavePhone?: string
    ): Promise<string> {
        try {
            const wallet = await this.createWallet({
                ownerId,
                ownerName,
                ownerWavePhone,
                entityType,
            })
            logger.info({ ownerId, entityType, walletId: wallet.id }, '[WalletBridge] Wallet auto-assigned')
            return wallet.id
        } catch (error) {
            logger.error({ ownerId, entityType, error }, '[WalletBridge] Failed to auto-assign wallet')
            throw error
        }
    }
}

export default new WalletBridgeService()
