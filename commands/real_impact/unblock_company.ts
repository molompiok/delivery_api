import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { DateTime } from 'luxon'
import SubscriptionInvoice from '#models/subscription_invoice'

export default class UnblockCompany extends BaseCommand {
    static commandName = 'patch:unblock_company'
    static description = 'Force mark invoices as PAID for a specific company to unblock testing'

    static options: CommandOptions = {
        startApp: true,
    }

    async run() {
        const companyId = 'cmp_m1lweyvo8dfmytbgx7'
        const now = DateTime.utc()

        this.logger.info(`Unblocking company ${companyId}...`)

        const affected = await SubscriptionInvoice.query()
            .where('company_id', companyId)
            .whereIn('status', ['ISSUED', 'OVERDUE'])
            .update({
                status: 'PAID',
                paidAt: now,
            })

        this.logger.success(`Marked ${affected.length} invoices as PAID for ${companyId}`)
    }
}
