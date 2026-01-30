import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import User from '#models/user'
import DriverSetting from '#models/driver_setting'
import RedisService from '#services/redis_service'
import logger from '@adonisjs/core/services/logger'

export default class CheckDispatchReadiness extends BaseCommand {
  static commandName = 'check:dispatch:readiness'
  static description = 'Verify system readiness for order dispatching (drivers, Redis sync, etc.)'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('🔍 Checking Dispatch System Readiness...\n')

    try {
      // 1. Check Drivers in Database
      const totalDrivers = await User.query().where('isDriver', true).count('* as total')
      const driversCount = Number(totalDrivers[0].$extras.total)
      this.logger.info(`📊 Total Drivers in DB: ${driversCount}`)

      if (driversCount === 0) {
        this.logger.warning('⚠️  No drivers found in database. Run seeders first.')
        return
      }

      // 2. Check Driver Settings
      const driverSettings = await DriverSetting.query()
      this.logger.info(`📊 Driver Settings Records: ${driverSettings.length}`)

      // 3. Check Redis Sync
      let onlineCount = 0
      let offlineCount = 0
      let busyCount = 0
      let withGPSCount = 0
      let missingInRedis = 0

      for (const driver of driverSettings) {
        const state = await RedisService.getDriverState(driver.userId)

        if (!state) {
          missingInRedis++
          continue
        }

        if (state.status === 'ONLINE') onlineCount++
        else if (state.status === 'BUSY') busyCount++
        else offlineCount++

        if (state.last_lat && state.last_lng) withGPSCount++
      }

      this.logger.info(`\n📡 Redis State Summary:`)
      this.logger.info(`   ✅ ONLINE: ${onlineCount}`)
      this.logger.info(`   🚗 BUSY: ${busyCount}`)
      this.logger.info(`   ⭕ OFFLINE: ${offlineCount}`)
      this.logger.info(`   📍 With GPS Position: ${withGPSCount}`)

      if (missingInRedis > 0) {
        this.logger.warning(`   ⚠️  Missing in Redis: ${missingInRedis} (run warmup)`)
      }

      // 4. Check Companies
      const Company = (await import('#models/company')).default
      const companies = await Company.query()
      this.logger.info(`\n🏢 Companies: ${companies.length}`)

      for (const company of companies) {
        const companyDrivers = await User.query()
          .where('companyId', company.id)
          .where('isDriver', true)

        let companyOnline = 0
        for (const driver of companyDrivers) {
          const state = await RedisService.getDriverState(driver.id)
          if (state?.status === 'ONLINE' && state.active_company_id === company.id) {
            companyOnline++
          }
        }

        this.logger.info(`   - ${company.name}: ${companyDrivers.length} drivers (${companyOnline} ONLINE)`)
      }

      // 5. Recommendations
      this.logger.info(`\n💡 Recommendations:`)
      if (onlineCount === 0) {
        this.logger.warning('   ⚠️  No drivers ONLINE. Set driver status to ONLINE for testing.')
      }
      if (withGPSCount === 0) {
        this.logger.warning('   ⚠️  No drivers have GPS positions. Update driver locations in Redis.')
      }
      if (missingInRedis > 0) {
        this.logger.warning('   ⚠️  Redis not synced. Restart server or run warmup manually.')
      }

      if (onlineCount > 0 && withGPSCount > 0) {
        this.logger.success('\n✅ System ready for dispatch testing!')
      } else {
        this.logger.warning('\n⚠️  System not fully ready. Address recommendations above.')
      }

    } catch (error) {
      this.logger.error('❌ Error checking dispatch readiness:', error)
      logger.error({ err: error }, 'Dispatch readiness check failed')
    }
  }
}