import type { HttpContext } from '@adonisjs/core/http'
import crypto from 'node:crypto'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import orderPaymentService from '#services/order_payment_service'

export default class WaveWebhooksController {
    private secret = env.get('WAVE_API_KEY')

    /**
     * Reçoit et vérifie le webhook de wave-api
     */
    public async handle({ request, response }: HttpContext) {
        const signature = request.header('X-Wave-Signature')
        const event = request.header('X-Wave-Event')
        const rawBody = request.raw() || ''

        if (!signature || !event || !this.secret) {
            logger.error('[WaveWebhook] Missing signature, event or secret')
            return response.unauthorized({ message: 'Missing security headers' })
        }

        // Vérification de la signature
        const expectedSignature = crypto.createHmac('sha256', this.secret).update(rawBody).digest('hex')

        if (signature !== expectedSignature) {
            logger.error({ signature, expectedSignature }, '[WaveWebhook] Invalid signature')
            return response.unauthorized({ message: 'Invalid signature' })
        }

        const payload = request.body()
        logger.info({ event, intentId: payload.data?.externalReference }, '[WaveWebhook] Webhook received and verified')

        try {
            if (event === 'payment.completed') {
                await orderPaymentService.handleExternalWebhook(payload.data)
            } else if (event === 'ledger.new' || event === 'ledger.updated') {
                await orderPaymentService.handleLedgerWebhook(payload.data)
            } else if (event === 'payment.failed') {
                // Optionnel: log ou notification spécifique d'échec
                logger.warn({ intentId: payload.data?.externalReference }, '[WaveWebhook] Payment failed reported')
            }

            return response.ok({ status: 'processed' })
        } catch (error) {
            logger.error({ err: error }, '[WaveWebhook] Error processing webhook')
            return response.internalServerError({ message: error.message })
        }
    }
}
