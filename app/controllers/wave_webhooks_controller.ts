import type { HttpContext } from '@adonisjs/core/http'
import crypto from 'node:crypto'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import orderPaymentService from '#services/order_payment_service'

export default class WaveWebhooksController {
    private secret = env.get('WAVE_WEBHOOK_SECRET') || env.get('WAVE_API_KEY')

    /**
     * Reçoit et vérifie le webhook de wave-api
     */
    public async handle({ request, response }: HttpContext) {
        const signature = request.header('X-Wave-Signature') || request.header('x-wave-signature')
        const event = request.header('X-Wave-Event') || request.header('x-wave-event')
        const managerId = request.header('X-Manager-Id') || request.header('x-manager-id')
        const webhookId = request.header('X-Webhook-Id') || request.header('x-webhook-id')
        const rawBody = request.raw() || ''

        if (!signature || !event || !this.secret) {
            logger.error({ managerId, webhookId }, '[WaveWebhook] Missing signature, event or secret')
            return response.unauthorized({ message: 'Missing security headers' })
        }

        // Vérification de la signature
        const expectedSignature = crypto.createHmac('sha256', this.secret).update(rawBody).digest('hex')
        const receivedBuffer = Buffer.from(signature, 'utf8')
        const expectedBuffer = Buffer.from(expectedSignature, 'utf8')
        const isValidSignature =
            receivedBuffer.length === expectedBuffer.length &&
            crypto.timingSafeEqual(receivedBuffer, expectedBuffer)

        if (!isValidSignature) {
            logger.error({ managerId, webhookId, event }, '[WaveWebhook] Invalid signature')
            return response.unauthorized({ message: 'Invalid signature' })
        }

        const payload = request.body()
        logger.info(
            { event, managerId, webhookId, intentId: payload.data?.externalReference },
            '[WaveWebhook] Webhook received and verified'
        )

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
            logger.error({ err: error, managerId, webhookId, event }, '[WaveWebhook] Error processing webhook')
            return response.internalServerError({ message: error.message })
        }
    }
}
