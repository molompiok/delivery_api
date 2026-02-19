import { BaseCommand } from '@adonisjs/core/ace'
import User from '#models/user'
import Company from '#models/company'
import CompanyDriverSetting from '#models/company_driver_setting'
import walletBridge from '#services/wallet_bridge_service'

/**
 * Formate un numéro de téléphone pour wave-api :
 * "+2250759929515" → "+225 0759929515"
 * Retourne undefined si le format est invalide
 */
function formatPhone(phone: string | null | undefined): string | undefined {
    if (!phone) return undefined
    // Déjà au bon format ?
    if (/^\+\d{1,3}\s\d+$/.test(phone)) return phone
    // Format compact : +2250759929515 → +225 0759929515
    const match = phone.match(/^\+(\d{1,3})(\d{8,})$/)
    if (match) return `+${match[1]} ${match[2]}`
    return undefined
}

export default class ProvisionWallets extends BaseCommand {
    public static commandName = 'wallets:provision'
    public static description = 'Crée un wallet Wave pour chaque User, Company et CompanyDriverSetting qui n\'en a pas encore'

    public static options = {
        startApp: true,
    }

    public async run() {
        this.logger.info('🏦 Provisionnement des wallets Wave...\n')

        // ─── 1. USERS ──────────────────────────────────────────
        const users = await User.query().whereNull('walletId').where('isActive', true)
        this.logger.info(`👤 Users sans wallet: ${users.length}`)

        let userOk = 0
        let userFail = 0
        for (const user of users) {
            try {
                // isDriver → DRIVER, sinon CLIENT (manager/client)
                const entityType = user.isDriver ? 'DRIVER' : 'CLIENT'
                const walletId = await walletBridge.autoAssignWallet(
                    user.id,
                    entityType,
                    user.fullName || user.email || user.id,
                    formatPhone(user.phone),
                )
                user.walletId = walletId
                await user.save()
                this.logger.success(`  ✅ ${user.fullName || user.email} → ${walletId} (${entityType})`)
                userOk++
            } catch (error) {
                this.logger.error(`  ❌ ${user.fullName || user.email}: ${(error as Error).message}`)
                userFail++
            }
        }

        // ─── 2. COMPANIES ──────────────────────────────────────
        const companies = await Company.query().whereNull('walletId')
        this.logger.info(`\n🏢 Companies sans wallet: ${companies.length}`)

        let companyOk = 0
        let companyFail = 0
        for (const company of companies) {
            try {
                const walletId = await walletBridge.autoAssignWallet(
                    company.id,
                    'COMPANY',
                    company.name,
                )
                company.walletId = walletId
                await company.save()
                this.logger.success(`  ✅ ${company.name} → ${walletId}`)
                companyOk++
            } catch (error) {
                this.logger.error(`  ❌ ${company.name}: ${(error as Error).message}`)
                companyFail++
            }
        }

        // ─── 3. COMPANY DRIVER SETTINGS ────────────────────────
        const cdsRecords = await CompanyDriverSetting.query()
            .whereNull('walletId')
            .preload('driver')
            .preload('company')
        this.logger.info(`\n🚗 CompanyDriverSettings sans wallet: ${cdsRecords.length}`)

        let cdsOk = 0
        let cdsFail = 0
        for (const cds of cdsRecords) {
            try {
                const driverName = cds.driver?.fullName || cds.driverId
                const companyName = cds.company?.name || cds.companyId
                const walletId = await walletBridge.autoAssignWallet(
                    cds.id,
                    'COMPANY_DRIVER',
                    `${driverName} @ ${companyName}`,
                    formatPhone(cds.driver?.phone),
                )
                cds.walletId = walletId
                await cds.save()
                this.logger.success(`  ✅ ${driverName} @ ${companyName} → ${walletId}`)
                cdsOk++
            } catch (error) {
                this.logger.error(`  ❌ ${cds.driverId} @ ${cds.companyId}: ${(error as Error).message}`)
                cdsFail++
            }
        }

        // ─── RÉSUMÉ ────────────────────────────────────────────
        this.logger.info('\n📊 Résumé:')
        this.logger.info(`  Users:    ${userOk} créés, ${userFail} échoués (${users.length} total)`)
        this.logger.info(`  Companies: ${companyOk} créés, ${companyFail} échoués (${companies.length} total)`)
        this.logger.info(`  CDS:      ${cdsOk} créés, ${cdsFail} échoués (${cdsRecords.length} total)`)

        if (userFail + companyFail + cdsFail === 0) {
            this.logger.success('\n🎉 Tous les wallets ont été provisionnés avec succès!')
        } else {
            this.logger.warning(`\n⚠️  ${userFail + companyFail + cdsFail} erreur(s) lors du provisionnement.`)
        }
    }
}
