import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { DateTime } from 'luxon'
import PaymentIntent from '#models/payment_intent'
import Order from '#models/order'
import User from '#models/user'
import orderPaymentService from '#services/order_payment_service'

export default class VerifyPaymentExpiry extends BaseCommand {
    static commandName = 'test:payment:expiry'
    static description = 'Verify payment expiration logic with a 4-minute window'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        this.logger.info('🚀 Starting Payment Expiry Test (4 minutes)...')

        // Find or create a valid user and order
        let user = await User.first()
        let order = await Order.first()

        if (!user) {
            this.logger.info('Creating dummy user for test...')
            user = await User.create({
                fullName: 'Test User',
                email: 'test' + Date.now() + '@example.com',
                password: 'password123',
            })
        }

        if (!order) {
            this.logger.info('Creating dummy order for test...')
            order = await Order.create({
                id: 'test-order-id',
                clientId: user.id,
                status: 'DRAFT',
                template: 'COMMANDE',
            })
        }

        this.logger.info(`Using User: ${user.id} and Order: ${order.id}`)

        // 1. Create a PaymentIntent expiring in 4 minutes
        const expiresAt = DateTime.now().plus({ minutes: 4 })
        const intent = await PaymentIntent.create({
            orderId: order.id,
            payerId: user.id,
            amount: 1000,
            calculatedAmount: 1000,
            paymentMethod: 'WAVE',
            status: 'PENDING',
            expiresAt: expiresAt,
        })

        this.logger.success(`Intent created: ${intent.id}`)
        this.logger.info(`Expires at: ${expiresAt.toFormat('HH:mm:ss')} (in 4 minutes)`)

        // 2. Initial check
        let current = await PaymentIntent.find(intent.id)
        this.logger.info('Initial Status: ' + current?.status)

        this.logger.info('⏳ Starting real-time countdown (4 minutes)...')

        const totalSeconds = 4 * 60
        for (let i = totalSeconds; i >= 0; i--) {
            const minutes = Math.floor(i / 60)
            const seconds = i % 60
            process.stdout.write(`\rTime remaining: ${minutes}:${seconds.toString().padStart(2, '0')}    `)
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
        console.log('\n')

        this.logger.info('⚙️ Running cleanup...')
        const cleaned = await orderPaymentService.cleanupAbandonedIntents()
        this.logger.info(`Intents cleaned in this batch: ${cleaned}`)

        // 3. Final check
        current = await PaymentIntent.find(intent.id)
        this.logger.info(`Final Status: ${current?.status}`)

        if (current?.status === 'FAILED') {
            this.logger.success('✅ Test PASSED: Intent is now FAILED.')
        } else {
            this.logger.error('❌ Test FAILED: Intent is still ' + current?.status)
        }
    }
}
