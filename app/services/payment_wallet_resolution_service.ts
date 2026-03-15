import Company from '#models/company'
import CompanyDriverSetting from '#models/company_driver_setting'
import DriverSetting from '#models/driver_setting'
import Order from '#models/order'
import User from '#models/user'
import walletProvisioningService from '#services/wallet_provisioning_service'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export interface ResolvedPaymentWallets {
  orderId: string
  companyId: string | null
  driverId: string | null
  driverWalletId: string | null
  companyWalletId: string | null
  companyDriverSettingId: string | null
  companyDriverWalletId: string | null
  platformWalletId: string | null
}

class PaymentWalletResolutionService {
  private readonly acceptedRelationStatuses = ['ACCEPTED', 'ACCESS_ACCEPTED']

  public async resolveForOrder(
    input: Order | string,
    trx?: TransactionClientContract
  ): Promise<ResolvedPaymentWallets> {
    const order =
      typeof input === 'string'
        ? await Order.query({ client: trx }).where('id', input).firstOrFail()
        : input

    let companyWalletId: string | null = null
    let companyDriverWalletId: string | null = null
    let companyDriverSettingId: string | null = null
    let driverWalletId: string | null = null

    if (order.driverId) {
      const profile = await DriverSetting.query({ client: trx }).where('userId', order.driverId).first()
      if (profile) {
        driverWalletId = await walletProvisioningService.ensureDriverProfileWallet(profile)
      } else {
        // Fallback for extreme cases (should not happen for a valid driver)
        const user = await User.query({ client: trx }).where('id', order.driverId).first()
        if (user) {
          driverWalletId = await walletProvisioningService.ensureUserWallet(user)
        }
      }
    }

    if (order.companyId) {
      const company = await Company.query({ client: trx }).where('id', order.companyId).first()
      if (company) {
        companyWalletId = await walletProvisioningService.ensureCompanyWallet(company)
      }
    }

    if (order.companyId && order.driverId) {
      const relation = await CompanyDriverSetting.query({ client: trx })
        .where('companyId', order.companyId)
        .where('driverId', order.driverId)
        .whereIn('status', this.acceptedRelationStatuses)
        .orderBy('updated_at', 'desc')
        .first()

      if (relation) {
        companyDriverSettingId = relation.id
        companyDriverWalletId = await walletProvisioningService.ensureCompanyDriverWallet(relation)
      }
    }

    return {
      orderId: order.id,
      companyId: order.companyId,
      driverId: order.driverId,
      driverWalletId,
      companyWalletId,
      companyDriverSettingId,
      companyDriverWalletId,
      platformWalletId: process.env.WAVE_PLATFORM_WALLET_ID || null,
    }
  }
}

export default new PaymentWalletResolutionService()
