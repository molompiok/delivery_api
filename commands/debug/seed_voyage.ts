import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { inject } from '@adonisjs/core'
import OrderService from '#services/order/index'
import db from '@adonisjs/lucid/services/db'

@inject()
export default class SeedVoyage extends BaseCommand {
    static commandName = 'debug:seed_voyage'
    static description = 'Force-seed a published 4-stop voyage for FastDelivery CI'

    static options: CommandOptions = {
        startApp: true,
    }

    @inject()
    async run(orderService: OrderService) {
        this.logger.info('🚀 Seeding Voyage...')

        const managerId = 'usr_ff2u5koqimaq025q9u'
        const vehicleId = 'vhc_s1gdd10gosf0lrgt0i'
        const driverId = 'usr_w7qzn6jylo01kjqfg7'

        const payload = {
            template: 'VOYAGE',
            assignment_mode: 'INTERNAL',
            priority: 'MEDIUM',
            vehicleId: vehicleId,
            driverId: driverId,
            metadata: {
                seatMap: {
                    seat_1: { isVip: true, rule: { type: 'addition', value: 1500 } },
                    seat_2: { isVip: false },
                    seat_3: { isVip: false },
                    seat_4: { isVip: true, rule: { type: 'multiplier', value: 1.5 } },
                },
            },
            steps: [
                {
                    sequence: 1,
                    stops: [
                        {
                            display_order: 1,
                            address: {
                                street: 'Yopougon, Abidjan',
                                lat: 5.334,
                                lng: -4.067,
                                city: 'Abidjan',
                                country: "Cote d'Ivoire",
                            },
                            actions: [],
                        },
                        {
                            display_order: 2,
                            address: {
                                street: 'Adjamé, Abidjan',
                                lat: 5.345,
                                lng: -4.022,
                                city: 'Abidjan',
                                country: "Cote d'Ivoire",
                            },
                            actions: [],
                        },
                        {
                            display_order: 3,
                            address: {
                                street: 'Cocody, Abidjan',
                                lat: 5.35,
                                lng: -3.967,
                                city: 'Abidjan',
                                country: "Cote d'Ivoire",
                            },
                            actions: [],
                        },
                        {
                            display_order: 4,
                            address: {
                                street: 'Riviera Faya, Abidjan',
                                lat: 5.362,
                                lng: -3.91,
                                city: 'Abidjan',
                                country: "Cote d'Ivoire",
                            },
                            actions: [],
                        },
                    ],
                },
            ],
        }

        try {
            const trx = await db.transaction()
            try {
                this.logger.info('1. Creating Draft Voyage...')
                const order = await orderService.createOrder(managerId, payload, trx)

                // Manually assign driver for this internal voyage
                order.driverId = driverId
                await order.useTransaction(trx).save()

                this.logger.info(`2. Publishing Voyage (ID: ${order.id})...`)
                await orderService.publishOrder(order.id, managerId, { trx })

                await trx.commit()
                this.logger.success(`✅ Voyage created and published successfully: ${order.id}`)
            } catch (err) {
                await trx.rollback()
                throw err
            }
        } catch (error: any) {
            this.logger.error(`❌ Failed to seed voyage: ${error.message}`)
            this.exitCode = 1
        }
    }
}
