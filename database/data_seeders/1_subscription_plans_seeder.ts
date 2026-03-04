import { BaseSeeder } from '@adonisjs/lucid/seeders'
import SubscriptionPlan from '#models/subscription_plan'

export default class SubscriptionPlansSeeder extends BaseSeeder {
  async run() {
    console.log('  💳 Seeding Subscription Plans...')

    const plans = [
      {
        activityType: 'COMMANDE',
        baseAmount: 0,
        commandeCommissionPercent: 1,
        ticketFeePercent: 0,
        taxPercent: 0,
        currency: 'XOF',
        isActive: true,
        allowNewCompanies: true,
      },
      {
        activityType: 'VOYAGE',
        baseAmount: 100000,
        commandeCommissionPercent: 0,
        ticketFeePercent: 0,
        taxPercent: 0,
        currency: 'XOF',
        isActive: true,
        allowNewCompanies: true,
      },
      {
        activityType: 'MISSION',
        baseAmount: 100000,
        commandeCommissionPercent: 0,
        ticketFeePercent: 0,
        taxPercent: 0,
        currency: 'XOF',
        isActive: true,
        allowNewCompanies: true,
      },
    ]

    for (const plan of plans) {
      await SubscriptionPlan.updateOrCreate(
        { activityType: plan.activityType },
        {
          ...plan,
          metadata: {
            seeded: true,
            seededBy: '1_subscription_plans_seeder',
          },
        }
      )
    }
  }
}
