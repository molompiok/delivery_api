import { BaseCommand, flags, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import Company from '#models/company'
import SubscriptionService from '#services/subscription_service'
import { DateTime } from 'luxon'

export default class BillingGenerateInvoices extends BaseCommand {
    static commandName = 'billing:generate-invoices'
    static description = 'Generate monthly subscription invoices for all companies'

    static options: CommandOptions = {
        startApp: true,
    }

    @args.string({ description: 'The month to generate invoices for (YYYY-MM). Defaults to last month.', required: false })
    declare month?: string

    @flags.number({ description: 'Size of batches for processing companies', default: 10 })
    declare batchSize: number

    @flags.boolean({ description: 'Print detailed progress', default: false })
    declare verbose: boolean

    async run() {
        this.logger.info(`Starting invoice generation...`)

        // Resolve period once
        let periodStart: DateTime
        let periodEndExclusive: DateTime
        let monthKey: string

        try {
            // We use a dummy call to resolveMonthPeriod logic if we want to be consistent,
            // but SubscriptionService handles it in generateMonthlyInvoices.
            // To keep it simple and DRY, we'll let the service handle the parsing logic
            // but we need the variables for the loop.
            // So we'll use a private method or just reimplement the logic here.

            const targetMonth = this.month || DateTime.utc().startOf('month').minus({ months: 1 }).toFormat('yyyy-LL')
            const parsed = DateTime.fromFormat(targetMonth, 'yyyy-LL', { zone: 'utc' }).startOf('month')

            if (!parsed.isValid) {
                this.logger.error(`Invalid month format "${targetMonth}". Expected YYYY-MM`)
                this.exitCode = 1
                return
            }

            periodStart = parsed
            periodEndExclusive = parsed.plus({ months: 1 })
            monthKey = targetMonth
        } catch (error) {
            this.logger.error(`Error resolving period: ${error.message}`)
            this.exitCode = 1
            return
        }

        this.logger.info(`Target month: ${monthKey}`)
        this.logger.info(`Period: ${periodStart.toISODate()} to ${periodEndExclusive.minus({ days: 1 }).toISODate()}`)

        const companies = await Company.query().whereNotNull('activity_type')
        this.logger.info(`Found ${companies.length} companies to process.`)

        let generated = 0
        let updated = 0
        let skippedPaid = 0
        let failed = 0

        // Batch processing
        for (let i = 0; i < companies.length; i += this.batchSize) {
            const batch = companies.slice(i, i + this.batchSize)
            this.logger.info(`Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(companies.length / this.batchSize)}...`)

            await Promise.all(
                batch.map(async (company) => {
                    try {
                        const result = await SubscriptionService.generateInvoiceForCompany(
                            company.id,
                            periodStart,
                            periodEndExclusive,
                            monthKey,
                            null // generatedBy (System)
                        )

                        if (result === 'GENERATED') generated++
                        else if (result === 'UPDATED') updated++
                        else if (result === 'SKIPPED_PAID') skippedPaid++

                        if (this.verbose) {
                            this.logger.success(`[${company.name}] ${result}`)
                        }
                    } catch (error) {
                        failed++
                        this.logger.error(`[${company.name}] FAILED: ${error.message}`)
                    }
                })
            )
        }

        this.logger.success('Invoice generation completed.')
        this.logger.info(`Summary:`)
        this.logger.info(`- Generated: ${generated}`)
        this.logger.info(`- Updated:   ${updated}`)
        this.logger.info(`- Skipped:   ${skippedPaid} (Already paid)`)
        this.logger.info(`- Failed:    ${failed}`)
    }
}
