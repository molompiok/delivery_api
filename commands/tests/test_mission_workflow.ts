import { BaseCommand } from '@adonisjs/core/ace'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import OrderService from '#services/order/index'
import MissionService from '#services/mission_service'
import Order from '#models/order'
import { generateId } from '#utils/id_generator'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

type ActorContext = {
  managerId: string
  managerName: string | null
  companyId: string
  driverId: string
  driverName: string | null
  clientId: string
  clientName: string | null
}

@inject()
export default class TestMissionWorkflow extends BaseCommand {
  static commandName = 'test:mission_workflow'
  static description =
    'E2E MISSION + INTERVENTION workflow using existing manager/company/client/driver in a sterile transaction'

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

  /**
   * Resolve existing actors.
   * No creation / no mutation here (auth is skipped by ID selection only).
   */
  private async resolveExistingActors(trx: TransactionClientContract): Promise<ActorContext> {
    const managerCompanies = await db
      .from('companies as c')
      .useTransaction(trx)
      .innerJoin('users as u', 'u.id', 'c.owner_id')
      .where('u.is_driver', false)
      .where('u.is_active', true)
      .select(
        'c.id as company_id',
        'c.activity_type as activity_type',
        'u.id as manager_id',
        'u.full_name as manager_name'
      )

    if (managerCompanies.length === 0) {
      throw new Error('No existing manager/company pair found in database')
    }

    const prioritized = [
      ...managerCompanies.filter((item) => String(item.activity_type || '').toUpperCase() === 'MISSION'),
      ...managerCompanies.filter((item) => String(item.activity_type || '').toUpperCase() !== 'MISSION'),
    ]

    for (const candidate of prioritized) {
      let driver = await db
        .from('users')
        .useTransaction(trx)
        .where('is_driver', true)
        .where('is_active', true)
        .where('company_id', candidate.company_id)
        .whereNot('id', candidate.manager_id)
        .select('id', 'full_name', 'is_active')
        .first()

      if (!driver) {
        driver = await db
          .from('users')
          .useTransaction(trx)
          .where('is_driver', true)
          .where('company_id', candidate.company_id)
          .whereNot('id', candidate.manager_id)
          .select('id', 'full_name', 'is_active')
          .first()
      }

      if (!driver) {
        driver = await db
          .from('users')
          .useTransaction(trx)
          .where('is_driver', true)
          .where('is_active', true)
          .whereNot('id', candidate.manager_id)
          .select('id', 'full_name', 'is_active')
          .first()
      }

      if (!driver) {
        driver = await db
          .from('users')
          .useTransaction(trx)
          .where('is_driver', true)
          .whereNot('id', candidate.manager_id)
          .select('id', 'full_name', 'is_active')
          .first()
      }

      if (!driver) continue

      let client = await db
        .from('users')
        .useTransaction(trx)
        .where('is_driver', false)
        .where('is_active', true)
        .whereNot('id', candidate.manager_id)
        .whereNot('id', driver.id)
        .select('id', 'full_name')
        .first()

      if (!client) {
        client = await db
          .from('users')
          .useTransaction(trx)
          .where('is_driver', false)
          .whereNot('id', candidate.manager_id)
          .whereNot('id', driver.id)
          .select('id', 'full_name')
          .first()
      }

      if (!client) continue

      return {
        managerId: candidate.manager_id,
        managerName: candidate.manager_name,
        companyId: candidate.company_id,
        driverId: driver.id,
        driverName: driver.full_name,
        clientId: client.id as string,
        clientName: (client.full_name ?? null) as string | null,
      }
    }

    const [driverCountRow, clientCountRow] = await Promise.all([
      db.from('users').useTransaction(trx).where('is_driver', true).count('* as total').first(),
      db.from('users').useTransaction(trx).where('is_driver', false).count('* as total').first(),
    ])

    const driverCount = Number(driverCountRow?.total || 0)
    const clientCount = Number(clientCountRow?.total || 0)

    throw new Error(
      `No valid manager/company/driver/client set found. Existing data: drivers=${driverCount}, clients=${clientCount}. ` +
        'Required: manager-owned company + 1 driver + 1 client.'
    )
  }

  private async httpPostCompanyB2BAuthorizeClient(
    managerId: string,
    companyId: string,
    clientId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /companies/:companyId/b2b
    // body: { client_id: "<clientId>" }
    // Note: this controller currently has no dedicated service and writes directly to pivot.
    this.logger.info(`[HTTP] POST /companies/${companyId}/b2b (manager -> authorize client=${clientId})`)

    const company = await db
      .from('companies')
      .useTransaction(trx)
      .where('id', companyId)
      .where('owner_id', managerId)
      .select('id', 'owner_id')
      .first()

    if (!company) {
      throw new Error('B2B authorization failed: manager is not owner of target company')
    }

    if (clientId === managerId) {
      throw new Error('B2B authorization failed: owner cannot be added as partner')
    }

    const existing = await db
      .from('company_b2b_partners')
      .useTransaction(trx)
      .where('company_id', companyId)
      .where('client_id', clientId)
      .first()

    if (existing) {
      await db
        .from('company_b2b_partners')
        .useTransaction(trx)
        .where('company_id', companyId)
        .where('client_id', clientId)
        .update({
          status: 'ACTIVE',
          updated_at: new Date(),
        })
      this.logger.info(
        `[HTTP] 200 /companies/${companyId}/b2b | existing partnership updated to ACTIVE`
      )
      return
    }

    await db.table('company_b2b_partners').useTransaction(trx).insert({
      id: generateId('b2b'),
      company_id: companyId,
      client_id: clientId,
      status: 'ACTIVE',
      created_at: new Date(),
      updated_at: new Date(),
    })

    this.logger.info(`[HTTP] 201 /companies/${companyId}/b2b | partnership created ACTIVE`)
  }

  private async assertNoPaymentIntents(
    orderId: string,
    trx: TransactionClientContract,
    label: string
  ) {
    const row = await db
      .from('payment_intents')
      .useTransaction(trx)
      .where('order_id', orderId)
      .count('* as total')
      .first()

    const total = Number(row?.total || 0)
    if (total > 0) {
      throw new Error(`${label}: expected 0 PaymentIntent, found ${total}`)
    }
  }

  private async httpPostOrdersStore(
    orderService: OrderService,
    managerId: string,
    payload: any,
    trx: TransactionClientContract
  ) {
    // HTTP POST /orders
    // body: payload mission standard
    this.logger.info('[HTTP] POST /orders (manager -> createOrder)')
    const order = await orderService.createOrder(managerId, payload, trx)
    this.logger.info(`[HTTP] 201 /orders | orderId=${order.id} status=${order.status}`)
    return order
  }

  private async httpPostOrdersSubmit(
    orderService: OrderService,
    managerId: string,
    orderId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /orders/:id/submit
    this.logger.info(`[HTTP] POST /orders/${orderId}/submit`)
    const order = await orderService.submitOrder(orderId, managerId, trx)
    this.logger.info(`[HTTP] 200 /orders/${orderId}/submit | status=${order.status}`)
    return order
  }

  private async httpPostMissionsAccept(
    missionService: MissionService,
    driverId: string,
    orderId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /missions/:id/accept
    this.logger.info(`[HTTP] POST /missions/${orderId}/accept`)
    const order = await missionService.acceptMission(driverId, orderId, trx)
    this.logger.info(`[HTTP] 200 /missions/${orderId}/accept | status=${order.status}`)
    return order
  }

  private async httpPostMissionsArrivedAtStop(
    missionService: MissionService,
    driverId: string,
    stopId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /missions/stops/:stopId/arrived
    this.logger.info(`[HTTP] POST /missions/stops/${stopId}/arrived`)
    const stop = await missionService.arrivedAtStop(driverId, stopId, trx)
    this.logger.info(`[HTTP] 200 /missions/stops/${stopId}/arrived | status=${stop.status}`)
    return stop
  }

  private async httpPostMissionsCompleteAction(
    missionService: MissionService,
    driverId: string,
    actionId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /missions/actions/:actionId/complete
    // body: { proofs: {} } + no files
    this.logger.info(`[HTTP] POST /missions/actions/${actionId}/complete`)
    const action = await missionService.completeAction(driverId, actionId, {}, [], trx)
    this.logger.info(`[HTTP] 200 /missions/actions/${actionId}/complete | status=${action.status}`)
    return action
  }

  private async httpPostMissionsCompleteStop(
    missionService: MissionService,
    driverId: string,
    stopId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /missions/stops/:stopId/complete
    this.logger.info(`[HTTP] POST /missions/stops/${stopId}/complete`)
    const stop = await missionService.completeStop(driverId, stopId, trx)
    this.logger.info(`[HTTP] 200 /missions/stops/${stopId}/complete | status=${stop.status}`)
    return stop
  }

  private async httpPostMissionsFinish(
    missionService: MissionService,
    driverId: string,
    orderId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /missions/:id/finish
    this.logger.info(`[HTTP] POST /missions/${orderId}/finish`)
    const order = await missionService.completeOrder(driverId, orderId, trx)
    this.logger.info(`[HTTP] 200 /missions/${orderId}/finish | status=${order.status}`)
    return order
  }

  private async httpPostMissionsCreateIntervention(
    orderService: OrderService,
    clientId: string,
    payload: any,
    trx: TransactionClientContract
  ) {
    // HTTP POST /missions/intervention
    // body: payload intervention client
    this.logger.info('[HTTP] POST /missions/intervention (client -> createIntervention)')
    const order = await orderService.createIntervention(clientId, payload, trx)
    this.logger.info(`[HTTP] 201 /missions/intervention | orderId=${order.id} status=${order.status}`)
    return order
  }

  /**
   * Technical lookup for IDs used as URL params (stopId/actionId) in mission HTTP flow.
   * No business mutation here.
   */
  private async getExecutionStopsAndActions(orderId: string, trx: TransactionClientContract) {
    const stops = await db
      .from('stops')
      .useTransaction(trx)
      .where('order_id', orderId)
      .orderByRaw('COALESCE(execution_order, display_order) ASC')
      .select('id')

    const stopActionMap = new Map<string, string[]>()
    for (const stop of stops) {
      const actions = await db
        .from('actions')
        .useTransaction(trx)
        .where('stop_id', stop.id)
        .orderBy('created_at', 'asc')
        .select('id')

      stopActionMap.set(
        stop.id,
        actions.map((action) => action.id)
      )
    }

    return { stopIds: stops.map((stop) => stop.id), stopActionMap }
  }

  private async executeMissionLifecycle(
    missionService: MissionService,
    trx: TransactionClientContract,
    orderId: string,
    driverId: string
  ) {
    const executionGraph = await this.getExecutionStopsAndActions(orderId, trx)
    this.logger.info(
      `[DEBUG] mission execution graph | stops=${executionGraph.stopIds.length} orderId=${orderId}`
    )

    for (const stopId of executionGraph.stopIds) {
      await this.httpPostMissionsArrivedAtStop(missionService, driverId, stopId, trx)

      const actionIds = executionGraph.stopActionMap.get(stopId) || []
      this.logger.info(`[DEBUG] stop=${stopId} actions=${actionIds.length}`)

      for (const actionId of actionIds) {
        await this.httpPostMissionsCompleteAction(missionService, driverId, actionId, trx)
      }

      await this.httpPostMissionsCompleteStop(missionService, driverId, stopId, trx)
    }

    await this.httpPostMissionsFinish(missionService, driverId, orderId, trx)

    const pending = await db
      .from('actions')
      .useTransaction(trx)
      .where('order_id', orderId)
      .where('status', 'PENDING')
      .count('* as total')
      .first()

    if (Number(pending?.total || 0) > 0) {
      throw new Error('Expected no PENDING actions after mission completion')
    }

    const finalOrder = await Order.findOrFail(orderId, { client: trx })
    if (finalOrder.status !== 'DELIVERED') {
      throw new Error(`Expected DELIVERED final status, got ${finalOrder.status}`)
    }
  }

  private async runScenarioAStandardMission(
    orderService: OrderService,
    missionService: MissionService,
    trx: TransactionClientContract,
    ctx: ActorContext
  ) {
    const payload = {
      template: 'MISSION',
      assignment_mode: 'INTERNAL',
      targetCompanyId: ctx.companyId,
      priority: 'HIGH',
      transit_items: [
        { id: 'ti_item_a', name: 'Kit reseau A', weight: 5 },
        { id: 'ti_item_b', name: 'Kit reseau B', weight: 3 },
      ],
      steps: [
        {
          sequence: 1,
          stops: [
            {
              display_order: 1,
              address: {
                street: 'Plateau, Abidjan',
                lat: 5.3237,
                lng: -4.0268,
                city: 'Abidjan',
                country: "Côte d'Ivoire",
              },
              actions: [
                { type: 'pickup', transit_item_id: 'ti_item_a', quantity: 1 },
                { type: 'service', service_time: 300, metadata: { note: 'Controle depart' } },
              ],
            },
            {
              display_order: 2,
              address: {
                street: 'Adjamé, Abidjan',
                lat: 5.3611,
                lng: -4.0435,
                city: 'Abidjan',
                country: "Côte d'Ivoire",
              },
              actions: [{ type: 'delivery', transit_item_id: 'ti_item_a', quantity: 1 }],
            },
            {
              display_order: 3,
              address: {
                street: 'Cocody Angre, Abidjan',
                lat: 5.3901,
                lng: -3.9574,
                city: 'Abidjan',
                country: "Côte d'Ivoire",
              },
              actions: [{ type: 'pickup', transit_item_id: 'ti_item_b', quantity: 1 }],
            },
            {
              display_order: 4,
              address: {
                street: 'Bingerville, Abidjan',
                lat: 5.3559,
                lng: -3.8854,
                city: 'Abidjan',
                country: "Côte d'Ivoire",
              },
              actions: [
                { type: 'delivery', transit_item_id: 'ti_item_b', quantity: 1 },
                { type: 'service', service_time: 300, metadata: { note: 'Cloture mission' } },
              ],
            },
          ],
        },
      ],
    }

    const draftOrder = await this.httpPostOrdersStore(orderService, ctx.managerId, payload, trx)
    const submittedOrder = await this.httpPostOrdersSubmit(orderService, ctx.managerId, draftOrder.id, trx)

    if (submittedOrder.status !== 'PENDING') {
      throw new Error(`Scenario A: expected PENDING after submit, got ${submittedOrder.status}`)
    }

    await this.assertNoPaymentIntents(submittedOrder.id, trx, 'Scenario A')
    await this.httpPostMissionsAccept(missionService, ctx.driverId, submittedOrder.id, trx)
    await this.executeMissionLifecycle(missionService, trx, submittedOrder.id, ctx.driverId)
  }

  private async runScenarioBClientIntervention(
    orderService: OrderService,
    missionService: MissionService,
    trx: TransactionClientContract,
    ctx: ActorContext
  ) {
    const interventionOrder = await this.httpPostMissionsCreateIntervention(
      orderService,
      ctx.clientId,
      {
        targetCompanyId: ctx.companyId,
        priority: 'HIGH',
        steps: [
          {
            sequence: 1,
            stops: [
              {
                display_order: 1,
                address: {
                  street: 'Riviera Palmeraie, Abidjan',
                  lat: 5.3735,
                  lng: -3.9352,
                  city: 'Abidjan',
                  country: "Côte d'Ivoire",
                },
                actions: [
                  {
                    type: 'service',
                    service_time: 420,
                    metadata: { note: 'Intervention client urgente' },
                  },
                ],
              },
            ],
          },
        ],
      },
      trx
    )

    const fetched = await Order.findOrFail(interventionOrder.id, { client: trx })
    if (fetched.status !== 'PENDING') {
      throw new Error(`Scenario B: expected PENDING, got ${fetched.status}`)
    }
    if (!fetched.isIntervention) {
      throw new Error('Scenario B: expected isIntervention=true')
    }
    if (fetched.template !== 'MISSION') {
      throw new Error(`Scenario B: expected template=MISSION, got ${fetched.template}`)
    }
    if (fetched.assignmentMode !== 'TARGET') {
      throw new Error(`Scenario B: expected assignmentMode=TARGET, got ${fetched.assignmentMode}`)
    }

    await this.assertNoPaymentIntents(fetched.id, trx, 'Scenario B')
    await this.httpPostMissionsAccept(missionService, ctx.driverId, fetched.id, trx)
    await this.executeMissionLifecycle(missionService, trx, fetched.id, ctx.driverId)
  }

  @inject()
  async run(orderService: OrderService, missionService: MissionService) {
    this.logger.info('=== Starting MISSION + INTERVENTION Workflow Validation ===')

    const failures: string[] = []
    const mainTrx = await db.transaction()

    try {
      const ctx = await this.resolveExistingActors(mainTrx)
      this.logger.info(
        `Actors resolved | manager=${ctx.managerId} (${ctx.managerName || 'N/A'}) company=${ctx.companyId} driver=${ctx.driverId} client=${ctx.clientId}`
      )
      await this.httpPostCompanyB2BAuthorizeClient(
        ctx.managerId,
        ctx.companyId,
        ctx.clientId,
        mainTrx
      )

      await this.runScenario('Scenario A - Standard Mission INTERNAL (4 stops)', failures, async () => {
        await this.runScenarioAStandardMission(orderService, missionService, mainTrx, ctx)
      })

      await this.runScenario('Scenario B - Client Intervention TARGET (1 stop)', failures, async () => {
        await this.runScenarioBClientIntervention(orderService, missionService, mainTrx, ctx)
      })
    } catch (error) {
      this.logFailure(failures, 'GLOBAL', error)
    } finally {
      await mainTrx.rollback()
      this.logger.info('Global transaction rolled back. Database is clean.')
    }

    if (failures.length > 0) {
      this.exitCode = 1
      this.logger.error('MISSION workflow validation finished with failures:')
      failures.forEach((failure) => this.logger.error(`  - ${failure}`))
      this.scheduleProcessExit()
      return
    }

    this.logger.success('MISSION workflow validation passed with zero failures.')
    this.scheduleProcessExit()
  }
}
