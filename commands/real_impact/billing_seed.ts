import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import Company from '#models/company'
import User from '#models/user'
import Order from '#models/order'
import PaymentIntent from '#models/payment_intent'
import SubscriptionPlan from '#models/subscription_plan'
import CompanySubscriptionHistory from '#models/company_subscription_history'
import subscriptionService from '#services/subscription_service'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { generateId } from '#utils/id_generator'

export default class BillingSeed extends BaseCommand {
    static commandName = 'billing:seed'
    static description = 'Seed 1 year of billing activity for a test company'

    static options: CommandOptions = {
        startApp: true,
    }

    @flags.string({ description: 'Specific Company ID to target (leaves existing orders intact unless --clear-orders is passed)', required: false })
    declare companyId: string

    @flags.boolean({ description: 'Clear existing orders & payments for this company', default: false })
    declare clearOrders: boolean

    @flags.string({ description: 'Email of the company owner (if creating SimulCorp)', default: 'simul@sublymus.com' })
    declare email: string

    @flags.string({ description: 'Name of the company (if creating SimulCorp)', default: 'SimulCorp' })
    declare companyName: string

    async run() {
        this.logger.info(`Starting seeding for ${this.companyName}...`)

        // 1. Ensure Plans have valid values
        const commandePlan = await SubscriptionPlan.findBy('activity_type', 'COMMANDE')
        if (commandePlan && commandePlan.baseAmount === 0) {
            commandePlan.baseAmount = 15000
            commandePlan.commandeCommissionPercent = 2.5
            await commandePlan.save()
        }

        const voyagePlan = await SubscriptionPlan.findBy('activity_type', 'VOYAGE')
        if (voyagePlan && voyagePlan.baseAmount === 0) {
            voyagePlan.baseAmount = 100000
            voyagePlan.commandeCommissionPercent = 1.0
            voyagePlan.ticketFeePercent = 0.5
            await voyagePlan.save()
        }

        let user: User | null = null
        let company: Company | null = null

        if (this.companyId) {
            company = await Company.find(this.companyId)
            if (!company) {
                this.logger.error(`Company ${this.companyId} not found`)
                return
            }
            user = await User.find(company.ownerId)
            this.logger.info(`Using existing company ${company.name} (owner: ${user?.email || 'N/A'})`)
            this.clearOrders = this.clearOrders || false // require explicit flag for existing companies
        } else {
            user = await User.findBy('email', this.email)
            if (!user) {
                user = await User.create({
                    email: this.email,
                    password: 'password123',
                    fullName: 'Simul User',
                })
                this.logger.success(`User created: ${user.email}`)
            }

            company = await Company.findBy('name', this.companyName)
            if (!company) {
                company = await Company.create({
                    name: this.companyName,
                    ownerId: user.id,
                    activityType: 'COMMANDE' as any,
                })
            }
            // For the default SimulCorp, we usually clear everything
            this.clearOrders = true
        }

        this.logger.info(`Clearing existing subscription history and invoices for ${company.name}...`)
        await db.from('subscription_invoices').where('company_id', company.id).delete()
        await db.from('company_subscription_histories').where('company_id', company.id).delete()

        if (this.clearOrders) {
            this.logger.info('Clearing existing orders and payments...')
            const ids = (await db.from('orders').where('company_id', company.id).select('id')).map(o => o.id)
            if (ids.length > 0) {
                await db.from('payment_intents').whereIn('order_id', ids).delete()
                await db.from('orders').whereIn('id', ids).delete()
            }
        }

        const startOfSim = DateTime.utc().startOf('month').minus({ months: 12 })

        // 4. Manual History (Backdated)
        await CompanySubscriptionHistory.create({
            id: generateId('subh'),
            companyId: company.id,
            activityType: 'COMMANDE' as any,
            baseAmount: 15000,
            commandeCommissionPercent: 2.5,
            ticketFeePercent: 0,
            taxPercent: 18,
            currency: 'XOF',
            planId: commandePlan?.id,
            effectiveFrom: startOfSim,
            effectiveUntil: startOfSim.plus({ months: 6, days: 15 }),
        })

        await CompanySubscriptionHistory.create({
            id: generateId('subh'),
            companyId: company.id,
            activityType: 'VOYAGE' as any,
            baseAmount: 100000,
            commandeCommissionPercent: 1.0,
            ticketFeePercent: 0.5,
            taxPercent: 18,
            currency: 'XOF',
            planId: voyagePlan?.id,
            effectiveFrom: startOfSim.plus({ months: 6, days: 15 }),
            effectiveUntil: null,
        })

        // 5. Generate Activity
        for (let m = 0; m < 12; m++) {
            const currentMonthStart = startOfSim.plus({ months: m })
            const currentMonthEnd = currentMonthStart.plus({ months: 1 })
            const monthKey = currentMonthStart.toFormat('yyyy-LL')

            this.logger.info(`Generating activity for ${monthKey}...`)

            const orderCount = Math.floor(Math.random() * 20) + 15
            for (let i = 0; i < orderCount; i++) {
                const deliveredAt = currentMonthStart.plus({
                    days: Math.floor(Math.random() * 25),
                    hours: Math.floor(Math.random() * 23)
                })
                const template = (deliveredAt < startOfSim.plus({ months: 6, days: 15 })) ? 'COMMANDE' : 'VOYAGE'

                const order = await Order.create({
                    companyId: company.id,
                    clientId: user!.id,
                    status: 'DELIVERED',
                    template: template as any,
                    deliveredAt,
                    createdAt: deliveredAt.minus({ hours: 2 }),
                })

                const amount = template === 'COMMANDE'
                    ? Math.floor(Math.random() * 50000) + 5000
                    : Math.floor(Math.random() * 200000) + 50000

                await PaymentIntent.create({
                    orderId: order.id,
                    payerId: user!.id,
                    amount,
                    calculatedAmount: amount,
                    status: 'COMPLETED',
                    paymentMethod: 'WAVE',
                })
            }

            await subscriptionService.generateInvoiceForCompany(
                company.id,
                currentMonthStart,
                currentMonthEnd,
                monthKey,
                null
            )
        }

        this.logger.success(`Seeding completed for ${company.name}.`)
    }
}
