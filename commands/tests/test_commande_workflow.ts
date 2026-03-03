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
export default class TestCommandeWorkflow extends BaseCommand {
  static commandName = 'test:commande_workflow'
  static description =
    'E2E COMMANDE workflow for INTERNAL + TARGET + GLOBAL in one sterile transaction'

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

  private async resolveActorsForCommande(trx: TransactionClientContract): Promise<ActorContext> {
    const managerCompanies = await db
      .from('companies as c')
      .useTransaction(trx)
      .innerJoin('users as u', 'u.id', 'c.owner_id')
      .where('u.is_driver', false)
      .where('u.is_active', true)
      .select('c.id as company_id', 'u.id as manager_id', 'u.full_name as manager_name')

    if (managerCompanies.length === 0) {
      throw new Error('No existing manager/company pair found in database')
    }

    for (const candidate of managerCompanies) {
      let driver = await db
        .from('users')
        .useTransaction(trx)
        .where('is_driver', true)
        .where('is_active', true)
        .where('company_id', candidate.company_id)
        .whereNot('id', candidate.manager_id)
        .select('id', 'full_name')
        .first()

      if (!driver) {
        driver = await db
          .from('users')
          .useTransaction(trx)
          .where('is_driver', true)
          .where('company_id', candidate.company_id)
          .whereNot('id', candidate.manager_id)
          .select('id', 'full_name')
          .first()
      }

      if (!driver) {
        driver = await db
          .from('users')
          .useTransaction(trx)
          .where('is_driver', true)
          .where('is_active', true)
          .whereNot('id', candidate.manager_id)
          .select('id', 'full_name')
          .first()
      }

      if (!driver) {
        driver = await db
          .from('users')
          .useTransaction(trx)
          .where('is_driver', true)
          .whereNot('id', candidate.manager_id)
          .select('id', 'full_name')
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
        driverId: driver.id as string,
        driverName: (driver.full_name ?? null) as string | null,
        clientId: client.id as string,
        clientName: (client.full_name ?? null) as string | null,
      }
    }

    throw new Error('No valid manager/company/driver/client set found for COMMANDE test')
  }

  private buildCommandePayload(assignmentMode: 'INTERNAL' | 'TARGET' | 'GLOBAL', targetCompanyId?: string) {
    const payload: any = {
      template: 'COMMANDE',
      assignment_mode: assignmentMode,
      priority: 'HIGH',
      transit_items: [{ id: 'ti_cmd_1', name: 'Parcel A', weight: 2 }],
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
                country: "Cote d'Ivoire",
              },
              actions: [{ type: 'pickup', transit_item_id: 'ti_cmd_1', quantity: 1 }],
            },
            {
              display_order: 2,
              address: {
                street: 'Cocody Angre, Abidjan',
                lat: 5.3901,
                lng: -3.9574,
                city: 'Abidjan',
                country: "Cote d'Ivoire",
              },
              actions: [{ type: 'delivery', transit_item_id: 'ti_cmd_1', quantity: 1 }],
            },
          ],
        },
      ],
    }

    if (assignmentMode === 'TARGET' && targetCompanyId) {
      payload.targetCompanyId = targetCompanyId
    }

    return payload
  }

  private async assertCommandeFieldContract(
    orderId: string,
    trx: TransactionClientContract,
    expected: {
      scenarioLabel: string
      template: 'COMMANDE'
      clientId: string
      companyId: string | null
    }
  ) {
    const order = await Order.findOrFail(orderId, { client: trx })

    if (order.template !== expected.template) {
      throw new Error(
        `${expected.scenarioLabel}: expected template=${expected.template}, got ${String(order.template)}`
      )
    }

    if (order.clientId !== expected.clientId) {
      throw new Error(
        `${expected.scenarioLabel}: expected clientId=${expected.clientId}, got ${String(order.clientId)}`
      )
    }

    if (order.companyId !== expected.companyId) {
      throw new Error(
        `${expected.scenarioLabel}: expected companyId=${String(expected.companyId)}, got ${String(order.companyId)}`
      )
    }
  }

  private async assertPaymentIntentsForCommande(
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
    if (total <= 0) {
      throw new Error(`${label}: expected PaymentIntent count > 0, found ${total}`)
    }
  }

  private async httpPostOrdersStore(
    orderService: OrderService,
    emitterId: string,
    payload: any,
    mode: 'INTERNAL' | 'TARGET' | 'GLOBAL',
    trx: TransactionClientContract
  ) {
    // HTTP POST /v1/orders
    // body: COMMANDE payload with assignment_mode
    this.logger.info(`[HTTP] POST /v1/orders | mode=${mode} emitter=${emitterId}`)
    const order = await orderService.createOrder(emitterId, payload, trx)
    this.logger.info(`[HTTP] 201 /v1/orders | orderId=${order.id} status=${order.status} mode=${mode}`)
    return order
  }

  private async httpPostOrdersSubmit(
    orderService: OrderService,
    emitterId: string,
    orderId: string,
    mode: 'INTERNAL' | 'TARGET' | 'GLOBAL',
    trx: TransactionClientContract
  ) {
    // HTTP POST /v1/orders/:id/submit
    this.logger.info(`[HTTP] POST /v1/orders/${orderId}/submit | mode=${mode} emitter=${emitterId}`)
    const order = await orderService.submitOrder(orderId, emitterId, trx)
    this.logger.info(`[HTTP] 200 /v1/orders/${orderId}/submit | status=${order.status}`)
    return order
  }

  private async httpPostMissionsAccept(
    missionService: MissionService,
    driverId: string,
    orderId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /v1/missions/:id/accept
    this.logger.info(`[HTTP] POST /v1/missions/${orderId}/accept | driver=${driverId}`)
    const order = await missionService.acceptMission(driverId, orderId, trx)
    this.logger.info(`[HTTP] 200 /v1/missions/${orderId}/accept | status=${order.status}`)
    return order
  }

  private async httpPostStopArrival(
    missionService: MissionService,
    driverId: string,
    stopId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /v1/stops/:stopId/arrival
    this.logger.info(`[HTTP] POST /v1/stops/${stopId}/arrival`)
    const stop = await missionService.arrivedAtStop(driverId, stopId, trx)
    this.logger.info(`[HTTP] 200 /v1/stops/${stopId}/arrival | status=${stop.status}`)
    return stop
  }

  private async httpPostActionComplete(
    missionService: MissionService,
    driverId: string,
    actionId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /v1/actions/:actionId/complete
    // body: { proofs: {} } with no file uploads
    this.logger.info(`[HTTP] POST /v1/actions/${actionId}/complete`)
    const action = await missionService.completeAction(driverId, actionId, {}, [], trx)
    this.logger.info(`[HTTP] 200 /v1/actions/${actionId}/complete | status=${action.status}`)
    return action
  }

  private async httpPostStopComplete(
    missionService: MissionService,
    driverId: string,
    stopId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /v1/stops/:stopId/complete
    this.logger.info(`[HTTP] POST /v1/stops/${stopId}/complete`)
    const stop = await missionService.completeStop(driverId, stopId, trx)
    this.logger.info(`[HTTP] 200 /v1/stops/${stopId}/complete | status=${stop.status}`)
    return stop
  }

  private async httpPostMissionFinish(
    missionService: MissionService,
    driverId: string,
    orderId: string,
    trx: TransactionClientContract
  ) {
    // HTTP POST /v1/missions/:id/finish
    this.logger.info(`[HTTP] POST /v1/missions/${orderId}/finish`)
    const order = await missionService.completeOrder(driverId, orderId, trx)
    this.logger.info(`[HTTP] 200 /v1/missions/${orderId}/finish | status=${order.status}`)
    return order
  }

  private async simulateManagerAuthorizeClientB2B(
    trx: TransactionClientContract,
    managerId: string,
    companyId: string,
    clientId: string
  ) {
    // HTTP POST /v1/companies/:companyId/b2b-clients
    // body: { client_id: "<clientId>" }
    this.logger.info(`[HTTP] POST /v1/companies/${companyId}/b2b-clients | manager=${managerId} client=${clientId}`)

    const company = await db
      .from('companies')
      .useTransaction(trx)
      .where('id', companyId)
      .where('owner_id', managerId)
      .select('id')
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
        .update({ status: 'ACTIVE', updated_at: new Date() })
      this.logger.info(`[HTTP] 200 /v1/companies/${companyId}/b2b-clients | partner set ACTIVE`)
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
    this.logger.info(`[HTTP] 201 /v1/companies/${companyId}/b2b-clients | partner created ACTIVE`)
  }

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

  private async executeCommandeLifecycle(
    missionService: MissionService,
    trx: TransactionClientContract,
    orderId: string,
    driverId: string,
    mode: 'INTERNAL' | 'TARGET' | 'GLOBAL'
  ) {
    const executionGraph = await this.getExecutionStopsAndActions(orderId, trx)
    this.logger.info(
      `[DEBUG] commande execution graph | mode=${mode} orderId=${orderId} stops=${executionGraph.stopIds.length}`
    )

    for (const stopId of executionGraph.stopIds) {
      await this.httpPostStopArrival(missionService, driverId, stopId, trx)

      const actionIds = executionGraph.stopActionMap.get(stopId) || []
      this.logger.info(`[DEBUG] mode=${mode} stop=${stopId} actions=${actionIds.length}`)

      for (const actionId of actionIds) {
        await this.httpPostActionComplete(missionService, driverId, actionId, trx)
      }

      await this.httpPostStopComplete(missionService, driverId, stopId, trx)
    }

    await this.httpPostMissionFinish(missionService, driverId, orderId, trx)

    const pending = await db
      .from('actions')
      .useTransaction(trx)
      .where('order_id', orderId)
      .where('status', 'PENDING')
      .count('* as total')
      .first()

    if (Number(pending?.total || 0) > 0) {
      throw new Error(`${mode}: expected no PENDING actions after completion`)
    }

    const finalOrder = await Order.findOrFail(orderId, { client: trx })
    if (finalOrder.status !== 'DELIVERED') {
      throw new Error(`${mode}: expected DELIVERED final status, got ${finalOrder.status}`)
    }
  }

  private async runScenarioInternal(
    orderService: OrderService,
    missionService: MissionService,
    trx: TransactionClientContract,
    ctx: ActorContext
  ) {
    const mode = 'INTERNAL'
    const payload = this.buildCommandePayload(mode)

    const created = await this.httpPostOrdersStore(orderService, ctx.managerId, payload, mode, trx)

    await this.assertCommandeFieldContract(created.id, trx, {
      scenarioLabel: 'Scenario A INTERNAL (after create)',
      template: 'COMMANDE',
      clientId: ctx.managerId,
      companyId: ctx.companyId,
    })

    const submitted = await this.httpPostOrdersSubmit(orderService, ctx.managerId, created.id, mode, trx)
    if (submitted.status !== 'PENDING') {
      throw new Error(`Scenario A INTERNAL: expected PENDING after submit, got ${submitted.status}`)
    }

    await this.assertCommandeFieldContract(submitted.id, trx, {
      scenarioLabel: 'Scenario A INTERNAL (after submit)',
      template: 'COMMANDE',
      clientId: ctx.managerId,
      companyId: ctx.companyId,
    })

    await this.assertPaymentIntentsForCommande(submitted.id, trx, 'Scenario A INTERNAL')
    await this.httpPostMissionsAccept(missionService, ctx.driverId, submitted.id, trx)
    await this.executeCommandeLifecycle(missionService, trx, submitted.id, ctx.driverId, mode)
  }

  private async runScenarioTarget(
    orderService: OrderService,
    missionService: MissionService,
    trx: TransactionClientContract,
    ctx: ActorContext
  ) {
    const mode = 'TARGET'
    const payload = this.buildCommandePayload(mode, ctx.companyId)

    const created = await this.httpPostOrdersStore(orderService, ctx.clientId, payload, mode, trx)

    await this.assertCommandeFieldContract(created.id, trx, {
      scenarioLabel: 'Scenario B TARGET (after create)',
      template: 'COMMANDE',
      clientId: ctx.clientId,
      companyId: ctx.companyId,
    })

    const submitted = await this.httpPostOrdersSubmit(orderService, ctx.clientId, created.id, mode, trx)
    if (submitted.status !== 'PENDING') {
      throw new Error(`Scenario B TARGET: expected PENDING after submit, got ${submitted.status}`)
    }

    await this.assertCommandeFieldContract(submitted.id, trx, {
      scenarioLabel: 'Scenario B TARGET (after submit)',
      template: 'COMMANDE',
      clientId: ctx.clientId,
      companyId: ctx.companyId,
    })

    await this.assertPaymentIntentsForCommande(submitted.id, trx, 'Scenario B TARGET')
    await this.httpPostMissionsAccept(missionService, ctx.driverId, submitted.id, trx)
    await this.executeCommandeLifecycle(missionService, trx, submitted.id, ctx.driverId, mode)
  }

  private async runScenarioGlobal(
    orderService: OrderService,
    missionService: MissionService,
    trx: TransactionClientContract,
    ctx: ActorContext
  ) {
    const mode = 'GLOBAL'
    const payload = this.buildCommandePayload(mode)

    const created = await this.httpPostOrdersStore(orderService, ctx.clientId, payload, mode, trx)

    await this.assertCommandeFieldContract(created.id, trx, {
      scenarioLabel: 'Scenario C GLOBAL (after create)',
      template: 'COMMANDE',
      clientId: ctx.clientId,
      companyId: null,
    })

    const submitted = await this.httpPostOrdersSubmit(orderService, ctx.clientId, created.id, mode, trx)
    if (submitted.status !== 'PENDING') {
      throw new Error(`Scenario C GLOBAL: expected PENDING after submit, got ${submitted.status}`)
    }

    await this.assertCommandeFieldContract(submitted.id, trx, {
      scenarioLabel: 'Scenario C GLOBAL (after submit)',
      template: 'COMMANDE',
      clientId: ctx.clientId,
      companyId: null,
    })

    await this.assertPaymentIntentsForCommande(submitted.id, trx, 'Scenario C GLOBAL')
    await this.httpPostMissionsAccept(missionService, ctx.driverId, submitted.id, trx)
    await this.executeCommandeLifecycle(missionService, trx, submitted.id, ctx.driverId, mode)
  }

  @inject()
  async run(orderService: OrderService, missionService: MissionService) {
    this.logger.info('=== Starting COMMANDE Workflow Validation (INTERNAL + TARGET + GLOBAL) ===')

    const failures: string[] = []
    const mainTrx = await db.transaction()

    try {
      const ctx = await this.resolveActorsForCommande(mainTrx)
      this.logger.info(
        `Actors resolved | manager=${ctx.managerId} (${ctx.managerName || 'N/A'}) company=${ctx.companyId} driver=${ctx.driverId} client=${ctx.clientId}`
      )

      await this.simulateManagerAuthorizeClientB2B(
        mainTrx,
        ctx.managerId,
        ctx.companyId,
        ctx.clientId
      )

      await this.runScenario('Scenario A - COMMANDE INTERNAL (manager emitter)', failures, async () => {
        await this.runScenarioInternal(orderService, missionService, mainTrx, ctx)
      })

      await this.runScenario('Scenario B - COMMANDE TARGET (client emitter)', failures, async () => {
        await this.runScenarioTarget(orderService, missionService, mainTrx, ctx)
      })

      await this.runScenario('Scenario C - COMMANDE GLOBAL (client emitter)', failures, async () => {
        await this.runScenarioGlobal(orderService, missionService, mainTrx, ctx)
      })
    } catch (error) {
      this.logFailure(failures, 'GLOBAL', error)
    } finally {
      await mainTrx.rollback()
      this.logger.info('Global transaction rolled back. Database is clean.')
    }

    if (failures.length > 0) {
      this.exitCode = 1
      this.logger.error('COMMANDE workflow validation finished with failures:')
      failures.forEach((failure) => this.logger.error(`  - ${failure}`))
      this.scheduleProcessExit()
      return
    }

    this.logger.success('COMMANDE workflow validation passed with zero failures.')
    this.scheduleProcessExit()
  }
}
