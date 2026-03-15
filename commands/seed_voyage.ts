import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import Company from '#models/company'
import User from '#models/user'
import Vehicle from '#models/vehicle'
import OrderService from '#services/order/index'
import Order from '#models/order'

@inject()
export default class SeedVoyage extends BaseCommand {
  static commandName = 'seed:voyage'
  static description = 'Seed a realistic voyage with 5 stops from Abidjan to Man'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({ description: 'Specific Company ID to target', required: false })
  declare companyId: string

  async run() {
    const orderService = await this.app.container.make(OrderService)
    this.logger.info('Starting Voyage Seeding...')

    let company: Company | null = null

    if (this.companyId) {
      company = await Company.find(this.companyId)
    } else {
      company = await Company.query().first()
    }

    if (!company) {
      this.logger.error('No company found to attach the voyage to.')
      return
    }

    this.logger.info(`Target Company: ${company.name} (${company.id})`)

    const trx = await db.transaction()

    try {
      // 1. Idempotent Driver
      let driver = await User.query({ client: trx })
        .where('companyId', company.id)
        .where('isDriver', true)
        .first()

      if (!driver) {
        driver = await User.create(
          {
            fullName: 'Chauffeur Seed',
            email: `driver_${Date.now()}@test.com`,
            password: 'password123',
            isDriver: true,
            companyId: company.id,
            isActive: true,
          },
          { client: trx }
        )
        this.logger.success(`Created new driver: ${driver.fullName}`)
      } else {
        this.logger.info(`Using existing driver: ${driver.fullName}`)
      }

      // 2. Idempotent Vehicle
      let vehicle = await Vehicle.query({ client: trx }).where('ownerId', company.id).first()

      if (!vehicle) {
        vehicle = await Vehicle.create(
          {
            ownerType: 'Company',
            ownerId: company.id,
            companyId: company.id,
            type: 'BUS_DOUBLE',
            brand: 'Scania',
            model: 'Touring',
            plate: 'ABC-123-XY',
            energy: 'DIESEL',
            verificationStatus: 'APPROVED',
            metadata: {
              capacity: 40,
              seatDisposition: Array.from({ length: 40 }, (_, i) => ({
                'id': `seat_${i + 1}`,
                'number': `${i + 1}`,
                '3d_data': { stage: 1, column: (i % 4) + 1, row: Math.floor(i / 4) + 1 },
              })),
            } as any,
          },
          { client: trx }
        )
        this.logger.success(`Created new vehicle: ${vehicle.plate}`)
      } else {
        this.logger.info(`Using existing vehicle: ${vehicle.plate}`)
      }

      // 3. Prepare Voyage Payload
      const seatMap: any = {}
      for (let i = 1; i <= 40; i++) {
        const id = `seat_${i}`
        if (i <= 10) {
          // VVIP: x2 multiplier
          seatMap[id] = {
            isVip: true,
            label: 'VVIP',
            rule: { type: 'multiplier', value: 2 },
            note: 'Prix x 2',
          }
        } else if (i <= 20) {
          // VIP: +1000
          seatMap[id] = {
            isVip: true,
            label: 'VIP',
            rule: { type: 'addition', value: 1000 },
            note: 'Supplément +1000 FCFA',
          }
        } else {
          seatMap[id] = { isVip: false, label: 'Standard' }
        }
      }

      const payload = {
        template: 'VOYAGE',
        assignment_mode: 'INTERNAL',
        priority: 'MEDIUM',
        vehicleId: vehicle.id,
        driverId: driver.id,
        metadata: {
          seatMap,
        },
        steps: [
          {
            sequence: 1,
            stops: [
              {
                display_order: 1,
                address: {
                  street: 'Gare Nord, Adjamé',
                  city: 'Abidjan',
                  lat: 5.3484,
                  lng: -4.0244,
                  country: "Cote d'Ivoire",
                },
                actions: [],
              },
              {
                display_order: 2,
                address: {
                  street: 'Gare Centrale',
                  city: 'Yamoussoukro',
                  lat: 6.8276,
                  lng: -5.2893,
                  country: "Cote d'Ivoire",
                },
                actions: [],
              },
              {
                display_order: 3,
                address: {
                  street: 'Arrêt Principal',
                  city: 'Bouaflé',
                  lat: 6.9904,
                  lng: -5.7442,
                  country: "Cote d'Ivoire",
                },
                actions: [],
              },
              {
                display_order: 4,
                address: {
                  street: 'Gare de Daloa',
                  city: 'Daloa',
                  lat: 6.8773,
                  lng: -6.4453,
                  country: "Cote d'Ivoire",
                },
                actions: [],
              },
              {
                display_order: 5,
                address: {
                  street: 'Gare de Man',
                  city: 'Man',
                  lat: 7.4125,
                  lng: -7.5539,
                  country: "Cote d'Ivoire",
                },
                actions: [],
              },
            ],
          },
        ],
      }

      // 4. Create Order
      const order = await orderService.createOrder(company.ownerId, payload, trx)
      this.logger.success(`Voyage Order created: ${order.id}`)

      // 5. Update Pricing Matrix
      const fullOrder = await Order.query({ client: trx })
        .where('id', order.id)
        .preload('stops', (q) => q.orderBy('displayOrder', 'asc'))
        .firstOrFail()

      const stops = fullOrder.stops
      const s1 = stops[0].id // Abidjan
      const s2 = stops[1].id // Yamoussoukro
      const s3 = stops[2].id // Bouaflé
      const s4 = stops[3].id // Daloa
      const s5 = stops[4].id // Man

      const matrix: any = {
        [s1]: { [s2]: 5000, [s3]: 7000, [s4]: 10000, [s5]: 15000 },
        [s2]: { [s3]: 3000, [s4]: 6000, [s5]: 12000 },
        [s3]: { [s4]: 4000, [s5]: 10000 },
        [s4]: { [s5]: 7000 },
      }

      fullOrder.pricingData = {
        ...fullOrder.pricingData,
        matrix,
        currency: 'XOF',
      }

      // Auto-publish
      fullOrder.status = 'PUBLISHED'

      await fullOrder.useTransaction(trx).save()
      this.logger.success('Pricing Matrix applied and Voyage PUBLISHED.')

      await trx.commit()
      this.logger.success('Seeding transaction committed.')
    } catch (error) {
      await trx.rollback()
      this.logger.error('Error during seeding: ' + error.message)
      if (error.stack) this.logger.debug(error.stack)
    }
  }
}
