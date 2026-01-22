import logger from '@adonisjs/core/services/logger'

/**
 * PaymentService (MOCK)
 * 
 * Ce service est utilisé pour simuler le processus de paiement.
 * Il permet de tester le cycle de vie complet des commandes sans intégration réelle.
 */
export class PaymentService {
    /**
     * Simule l'initiation d'un paiement
     */
    async initiatePayment(orderId: string, amount: number, method: string) {
        logger.info({ orderId, amount, method }, '[PAYMENT MOCK] Initiating payment')

        // Simule un délai réseau
        await new Promise(resolve => setTimeout(resolve, 500))

        return {
            success: true,
            paymentUrl: `https://mock-payment-gateway.com/pay/${orderId}`,
            transactionId: `MOCK_TX_${Math.random().toString(36).substring(7).toUpperCase()}`
        }
    }

    /**
     * Simule la vérification d'un statut de paiement
     * Pour les tests, renvoie toujours 'PAID'
     */
    async checkStatus(transactionId: string) {
        logger.info({ transactionId }, '[PAYMENT MOCK] Checking status')

        return {
            status: 'PAID', // Simule un succès immédiat
            transactionId,
            processedAt: new Date().toISOString()
        }
    }

    /**
     * TODO: Implémenter les vrais webhooks ici plus tard pour :
     * - Wave
     * - Orange Money
     * - MTN MoMo
     */
}

export default new PaymentService()
