/**
 * VOYAGE SYSTEM DOCUMENTATION & WORKFLOW VALIDATION
 * 
 * --- CONCEPT ---
 * A "Voyage" is a specialized type of Order (template='VOYAGE') that represents 
 * a scheduled transport service with multiple stops and individual seat bookings.
 * 
 * --- CORE COMPONENTS ---
 * 1. Order (template: 'VOYAGE'): The container for the entire trip.
 * 2. Stops & Steps: Define the route. A voyage can have N stops. 
 *    Pricing and availability are calculated per segment (e.g., Stop A to Stop C).
 * 3. Seat Map (order.metadata.seatMap): Defines the vehicle's layout and seat types.
 *    - VIP seats can have custom rules (fixed addition or multipliers).
 * 4. Bookings: Individual reservations linked to the voyage for specific segments and seats.
 * 
 * --- PRICING LOGIC ---
 * The system determines the price for a segment in this order:
 * A. PRICE MATRIX (Priority 1): 
 *    Defined in `order.pricingData.matrix`. It maps stop pairs to fixed prices.
 *    Example: { "stop_A": { "stop_C": 8000 } }
 * B. DISTANCE FALLBACK (Priority 2):
 *    If no matrix entry exists, it uses `calculateHaversineDistance` between stops 
 *    and applies the `PricingFilter` rates (Base Fee + Distance Fee).
 * C. SEAT SURCHARGE:
 *    The segment price is then adjusted by the seat's VIP rule (e.g., +1500 FCFA).
 * 
 * --- SEGMENT OVERLAP (INTELLIGENT BOOKING) ---
 * The system allows multiple bookings on the same seat as long as their segments
 * do not overlap. 
 * Condition: (New Booking Start < Existing Booking End) AND (New Booking End > Existing Booking Start)
 * 
 * This test ensures that:
 * - Voyages can only be booked when PUBLISHED.
 * - Overlapping bookings on the same seat are REJECTED.
 * - Non-overlapping bookings on the same seat are ACCEPTED.
 * - PaymentIntents are correctly generated per booking.
 */

import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import OrderService from '#services/order/index'
import BookingService from '#services/booking_service'
import VoyageService from '#services/voyage_service'
import Order from '#models/order'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

type VoyageActors = {
  managerId: string
  managerName: string | null
  companyId: string
  clientId: string
  clientName: string | null
  vehicleId: string
  vehicleCapacity: number
}

@inject()
export default class TestVoyageWorkflow extends BaseCommand {
  static commandName = 'test:voyage_workflow'
  static description =
    'Strict VOYAGE workflow validation using service calls matching controllers in a sterile transaction'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: false,
  }

  private logFailure(failures: string[], label: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const failure = `[${label}] ${message}`
    failures.push(failure)
    this.logger.error(failure)
  }

  private scheduleProcessExit() {
    const code = this.exitCode ?? 0
    setTimeout(() => process.exit(code), 0)
  }

  private async runScenario(label: string, failures: string[], fn: () => Promise<void>) {
    this.logger.info(`--- ${label} ---`)
    try {
      await fn()
      this.logger.success(`[${label}] Success`)
    } catch (error) {
      this.logFailure(failures, label, error)
    }
  }

  private parseVehicleCapacity(vehicle: { metadata?: any }): number {
    const rawMetadata = vehicle.metadata
    const metadata = typeof rawMetadata === 'string' ? JSON.parse(rawMetadata || '{}') : rawMetadata || {}
    const seatDisposition = metadata?.seatDisposition

    if (Array.isArray(seatDisposition) && seatDisposition.length > 0) {
      return seatDisposition.length
    }

    const cap = Number(metadata?.capacity || 0)
    return Number.isFinite(cap) && cap > 0 ? cap : 0
  }

  private async injectSeatDispositionIfMissing(
    trx: TransactionClientContract,
    vehicle: { id: string; metadata?: any }
  ): Promise<number> {
    const currentCapacity = this.parseVehicleCapacity(vehicle)
    if (currentCapacity > 0) return currentCapacity

    const rawMetadata = vehicle.metadata
    const metadata = typeof rawMetadata === 'string' ? JSON.parse(rawMetadata || '{}') : rawMetadata || {}
    metadata.seatDisposition = [
      { id: 'seat_1', number: '1A', '3d_data': { stage: 1, column: 1, row: 1 } },
      { id: 'seat_2', number: '1B', '3d_data': { stage: 1, column: 2, row: 1 } },
      { id: 'seat_3', number: '2A', '3d_data': { stage: 1, column: 1, row: 2 } },
    ]

    await db.from('vehicles').useTransaction(trx).where('id', vehicle.id).update({
      metadata: JSON.stringify(metadata),
      updated_at: new Date(),
    })

    this.logger.info(`[PRECONDITION] Injected temporary seatDisposition on vehicle=${vehicle.id}`)
    return metadata.seatDisposition.length
  }

  private async resolveActorsForVoyage(trx: TransactionClientContract): Promise<VoyageActors> {
    const managerCompanies = await db
      .from('companies as c')
      .useTransaction(trx)
      .innerJoin('users as u', 'u.id', 'c.owner_id')
      .where('u.is_driver', false)
      .where('u.is_active', true)
      .select('c.id as company_id', 'u.id as manager_id', 'u.full_name as manager_name')

    if (managerCompanies.length === 0) {
      throw new Error('No existing manager/company pair found for VOYAGE test')
    }

    for (const candidate of managerCompanies) {
      let vehicles = await db
        .from('vehicles')
        .useTransaction(trx)
        .where('company_id', candidate.company_id)
        .select('id', 'metadata')

      if (vehicles.length === 0) {
        const fallbackVehicle = await db
          .from('vehicles')
          .useTransaction(trx)
          .select('id', 'metadata')
          .first()

        if (!fallbackVehicle) {
          continue
        }

        await db.from('vehicles').useTransaction(trx).where('id', fallbackVehicle.id).update({
          company_id: candidate.company_id,
          owner_type: 'Company',
          owner_id: candidate.company_id,
          updated_at: new Date(),
        })

        this.logger.info(
          `[PRECONDITION] Attached vehicle=${fallbackVehicle.id} temporarily to company=${candidate.company_id}`
        )

        vehicles = await db
          .from('vehicles')
          .useTransaction(trx)
          .where('company_id', candidate.company_id)
          .select('id', 'metadata')
      }

      // Prefer already configured seat-capacity vehicle, fallback to first and inject temporary seatDisposition.
      let selectedVehicle = vehicles[0] as { id: string; metadata?: any }
      let selectedCapacity = this.parseVehicleCapacity(selectedVehicle)
      for (const vehicle of vehicles) {
        const cap = this.parseVehicleCapacity(vehicle)
        if (cap > selectedCapacity) {
          selectedVehicle = vehicle as any
          selectedCapacity = cap
        }
      }

      if (selectedCapacity <= 0) {
        selectedCapacity = await this.injectSeatDispositionIfMissing(trx, selectedVehicle)
      }

      let client = await db
        .from('users')
        .useTransaction(trx)
        .where('is_driver', false)
        .where('is_active', true)
        .whereNot('id', candidate.manager_id)
        .select('id', 'full_name')
        .first()

      if (!client) {
        client = await db
          .from('users')
          .useTransaction(trx)
          .where('is_driver', false)
          .whereNot('id', candidate.manager_id)
          .select('id', 'full_name')
          .first()
      }

      if (!client) continue

      return {
        managerId: candidate.manager_id,
        managerName: candidate.manager_name,
        companyId: candidate.company_id,
        clientId: client.id as string,
        clientName: (client.full_name ?? null) as string | null,
        vehicleId: selectedVehicle.id,
        vehicleCapacity: selectedCapacity,
      }
    }

    throw new Error('No valid manager/company/client/vehicle-capacity set found for VOYAGE test')
  }

  private buildVoyagePayload(ctx: VoyageActors) {
    return {
      template: 'VOYAGE',
      assignment_mode: 'INTERNAL',
      priority: 'MEDIUM',
      vehicleId: ctx.vehicleId,
      metadata: {
        seatMap: {
          seat_1: { isVip: true, rule: { type: 'addition', value: 1500 } },
        },
      },
      // NOTE: You can also define a pricing matrix here for fixed segment prices:
      // pricingData: {
      //   matrix: {
      //     "stop_id_1": { "stop_id_3": 5000 }
      //   }
      // },
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
  }

  private async assertVoyageFieldContract(
    orderId: string,
    trx: TransactionClientContract,
    expected: {
      label: string
      template: 'VOYAGE'
      assignmentMode: 'INTERNAL'
      clientId: string
      companyId: string
    }
  ) {
    const order = await Order.findOrFail(orderId, { client: trx })

    if (order.template !== expected.template) {
      throw new Error(`${expected.label}: expected template=${expected.template}, got ${String(order.template)}`)
    }
    if (order.assignmentMode !== expected.assignmentMode) {
      throw new Error(
        `${expected.label}: expected assignmentMode=${expected.assignmentMode}, got ${String(order.assignmentMode)}`
      )
    }
    if (order.clientId !== expected.clientId) {
      throw new Error(`${expected.label}: expected clientId=${expected.clientId}, got ${String(order.clientId)}`)
    }
    if (order.companyId !== expected.companyId) {
      throw new Error(`${expected.label}: expected companyId=${expected.companyId}, got ${String(order.companyId)}`)
    }
  }

  private async assertPaymentIntentUniquenessPerBooking(
    trx: TransactionClientContract,
    orderId: string,
    bookingIds: string[],
    label: string
  ) {
    const rows = await db
      .from('payment_intents')
      .useTransaction(trx)
      .where('order_id', orderId)
      .whereIn('booking_id', bookingIds)
      .whereNotNull('booking_id')
      .select('booking_id')

    const counts = new Map<string, number>()
    for (const id of bookingIds) counts.set(id, 0)

    for (const row of rows) {
      const bookingId = String(row.booking_id)
      counts.set(bookingId, (counts.get(bookingId) || 0) + 1)
    }

    for (const bookingId of bookingIds) {
      const total = counts.get(bookingId) || 0
      if (total !== 1) {
        throw new Error(`${label}: expected exactly 1 PaymentIntent for booking=${bookingId}, found ${total}`)
      }
    }
  }

  private async getOrderedStopIds(orderId: string, trx: TransactionClientContract): Promise<string[]> {
    const stops = await db
      .from('stops')
      .useTransaction(trx)
      .where('order_id', orderId)
      .orderByRaw('COALESCE(execution_order, display_order) ASC')
      .select('id')

    return stops.map((s) => String(s.id))
  }

  private async httpPostOrdersStore(
    orderService: OrderService,
    emitterId: string,
    payload: any,
    trx: TransactionClientContract
  ) {
    // HTTP POST /v1/orders
    // body: VOYAGE payload
    this.logger.info(`[HTTP] POST /v1/orders | emitter=${emitterId} template=VOYAGE`)
    const order = await orderService.createOrder(emitterId, payload, trx)
    this.logger.info(`[HTTP] 201 /v1/orders | orderId=${order.id} status=${order.status}`)
    return order
  }

  private async httpPostOrdersPublish(
    orderService: OrderService,
    emitterId: string,
    orderId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /v1/orders/:id/publish
    this.logger.info(`[HTTP] POST /v1/orders/${orderId}/publish | emitter=${emitterId}`)
    const order = await orderService.publishOrder(orderId, emitterId, { trx })
    this.logger.info(`[HTTP] 200 /v1/orders/${orderId}/publish | status=${order.status}`)
    return order
  }

  private async httpGetVoyages(voyageService: VoyageService, trx: TransactionClientContract) {
    // HTTP GET /v1/voyages
    this.logger.info('[HTTP] GET /v1/voyages')
    const voyages = await voyageService.listPublished(undefined, trx)
    this.logger.info(`[HTTP] 200 /v1/voyages | count=${voyages.length}`)
    return voyages
  }

  private async httpGetVoyage(
    voyageService: VoyageService,
    orderId: string,
    trx: TransactionClientContract
  ) {
    // HTTP GET /v1/voyages/:id
    this.logger.info(`[HTTP] GET /v1/voyages/${orderId}`)
    const voyage = await voyageService.getPublishedVoyage(orderId, trx)
    this.logger.info(`[HTTP] 200 /v1/voyages/${orderId} | status=${voyage.status}`)
    return voyage
  }

  private async httpGetVoyageSeats(
    voyageService: VoyageService,
    orderId: string,
    pickupStopId: string,
    dropoffStopId: string,
    trx: TransactionClientContract
  ) {
    // HTTP GET /v1/voyages/:id/seats?pickup_stop_id=&dropoff_stop_id=
    this.logger.info(
      `[HTTP] GET /v1/voyages/${orderId}/seats?pickup_stop_id=${pickupStopId}&dropoff_stop_id=${dropoffStopId}`
    )
    const seats = await voyageService.getSeats(orderId, pickupStopId, dropoffStopId, trx)
    this.logger.info(
      `[HTTP] 200 /v1/voyages/${orderId}/seats | available=${seats.availableCount} reserved=${seats.reservedCount}`
    )
    return seats
  }

  private async httpPostVoyageBooking(
    bookingService: BookingService,
    orderId: string,
    clientId: string,
    payload: { pickupStopId: string; dropoffStopId: string; seats: string[] },
    trx: TransactionClientContract
  ) {
    // HTTP POST /v1/voyages/:id/bookings
    // body: { pickupStopId, dropoffStopId, seats }
    this.logger.info(
      `[HTTP] POST /v1/voyages/${orderId}/bookings | client=${clientId} seats=${payload.seats.join(',')}`
    )
    const booking = await bookingService.createBooking(orderId, clientId, payload, trx)
    this.logger.info(`[HTTP] 201 /v1/voyages/${orderId}/bookings | bookingId=${booking.id}`)
    return booking
  }

  private async runStrictVoyageScenario(
    orderService: OrderService,
    bookingService: BookingService,
    voyageService: VoyageService,
    trx: TransactionClientContract,
    ctx: VoyageActors
  ) {
    const payload = this.buildVoyagePayload(ctx)

    const draftOrder = await this.httpPostOrdersStore(orderService, ctx.managerId, payload, trx)

    await this.assertVoyageFieldContract(draftOrder.id, trx, {
      label: 'VOYAGE after create',
      template: 'VOYAGE',
      assignmentMode: 'INTERNAL',
      clientId: ctx.managerId,
      companyId: ctx.companyId,
    })

    const beforePublish = await this.httpGetVoyages(voyageService, trx)
    if (beforePublish.some((v) => v.id === draftOrder.id)) {
      throw new Error('Draft voyage is visible in public published list')
    }

    const stopIds = await this.getOrderedStopIds(draftOrder.id, trx)
    if (stopIds.length < 4) {
      throw new Error(`Expected at least 4 stops for rigorous VOYAGE scenario, got ${stopIds.length}`)
    }

    // Booking must fail while draft
    try {
      await this.httpPostVoyageBooking(
        bookingService,
        draftOrder.id,
        ctx.clientId,
        { pickupStopId: stopIds[0], dropoffStopId: stopIds[1], seats: ['seat_1'] },
        trx
      )
      throw new Error('Booking was accepted while order is still DRAFT')
    } catch (error: any) {
      const message = error?.message || ''
      if (message === 'Booking was accepted while order is still DRAFT') {
        throw error
      }
      this.logger.info(`[DEBUG] Draft booking rejected as expected: ${message}`)
    }

    const publishedOrder = await this.httpPostOrdersPublish(orderService, ctx.managerId, draftOrder.id, trx)
    if (publishedOrder.status !== 'PUBLISHED') {
      throw new Error(`Expected PUBLISHED after publish, got ${publishedOrder.status}`)
    }

    const afterPublish = await this.httpGetVoyages(voyageService, trx)
    if (!afterPublish.some((v) => v.id === draftOrder.id)) {
      throw new Error('Published voyage is missing from public list')
    }

    const publishedDetails = await this.httpGetVoyage(voyageService, draftOrder.id, trx)
    if (publishedDetails.status !== 'PUBLISHED') {
      throw new Error(`Voyage details expected PUBLISHED, got ${publishedDetails.status}`)
    }

    const seatsBefore = await this.httpGetVoyageSeats(voyageService, draftOrder.id, stopIds[0], stopIds[1], trx)
    if (seatsBefore.availableCount <= 0) {
      throw new Error(
        `No available seats for booking segment before booking. vehicleCapacity=${ctx.vehicleCapacity}`
      )
    }

    const booking1 = await this.httpPostVoyageBooking(
      bookingService,
      draftOrder.id,
      ctx.clientId,
      { pickupStopId: stopIds[0], dropoffStopId: stopIds[1], seats: ['seat_1'] },
      trx
    )

    await this.assertPaymentIntentUniquenessPerBooking(trx, draftOrder.id, [booking1.id], 'After booking #1')

    const booking2 = await this.httpPostVoyageBooking(
      bookingService,
      draftOrder.id,
      ctx.clientId,
      { pickupStopId: stopIds[1], dropoffStopId: stopIds[3], seats: ['seat_1'] },
      trx
    )

    await this.assertPaymentIntentUniquenessPerBooking(
      trx,
      draftOrder.id,
      [booking1.id, booking2.id],
      'After booking #2'
    )

    // Overlapping segment with same seat must fail
    try {
      await this.httpPostVoyageBooking(
        bookingService,
        draftOrder.id,
        ctx.clientId,
        { pickupStopId: stopIds[0], dropoffStopId: stopIds[2], seats: ['seat_1'] },
        trx
      )
      throw new Error('Overlapping booking on same seat was accepted')
    } catch (error: any) {
      const message = error?.message || ''
      if (message === 'Overlapping booking on same seat was accepted') {
        throw error
      }
      this.logger.info(`[DEBUG] Overlapping booking rejected as expected: ${message}`)
    }

    const seatsAfter = await this.httpGetVoyageSeats(voyageService, draftOrder.id, stopIds[0], stopIds[1], trx)
    if (!seatsAfter.reservedSeats.includes('seat_1')) {
      throw new Error('seat_1 should be reserved on segment [stop0 -> stop1] after booking')
    }
  }

  @inject()
  async run(orderService: OrderService, bookingService: BookingService, voyageService: VoyageService) {
    this.logger.info('=== Starting Strict VOYAGE Workflow Validation ===')

    const failures: string[] = []
    const mainTrx = await db.transaction()

    try {
      const ctx = await this.resolveActorsForVoyage(mainTrx)
      this.logger.info(
        `Actors resolved | manager=${ctx.managerId} (${ctx.managerName || 'N/A'}) company=${ctx.companyId} client=${ctx.clientId} vehicle=${ctx.vehicleId} capacity=${ctx.vehicleCapacity}`
      )

      await this.runScenario('Scenario A - VOYAGE publish + bookings strict', failures, async () => {
        await this.runStrictVoyageScenario(orderService, bookingService, voyageService, mainTrx, ctx)
      })
    } catch (error) {
      this.logFailure(failures, 'GLOBAL', error)
    } finally {
      await mainTrx.rollback()
      this.logger.info('Global transaction rolled back. Database is clean.')
    }

    if (failures.length > 0) {
      this.exitCode = 1
      this.logger.error('VOYAGE workflow validation finished with failures:')
      failures.forEach((failure) => this.logger.error(`  - ${failure}`))
      this.scheduleProcessExit()
      return
    }

    this.logger.success('VOYAGE workflow validation passed with zero failures.')
    this.scheduleProcessExit()
  }
}
