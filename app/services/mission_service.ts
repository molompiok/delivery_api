import { updateMetadataField } from '#utils/json_utils'
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import Order from '#models/order'
import OrderStatusUpdated from '#events/order_status_updated'
import StopStatusUpdated from '#events/stop_status_updated'
import ActionStatusUpdated from '#events/action_status_updated'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import RedisService from '#services/redis_service'
import { inject } from '@adonisjs/core'
import DispatchService from '#services/dispatch_service'
import Stop from '#models/stop'
import Action from '#models/action'
import Step from '#models/step'
import OrderLeg from '#models/order_leg'
import { isValidCodeFormat } from '#utils/verification_code'
import { MultipartFile } from '@adonisjs/core/bodyparser'
import FileManager from '#services/file_manager'
import File from '#models/file'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import logisticsConfig from '#config/logistics'
import { getDistance } from '#utils/geo'
import OrderDraftService from '#services/order/order_draft_service'
import { GeoCompressor } from '#utils/geo_compressor'

@inject()
export default class MissionService {
    constructor(
        protected dispatchService: DispatchService,
        protected orderDraftService: OrderDraftService
    ) { }

    /**
     * Driver accepts a mission.
     */
    async acceptMission(driverId: string, orderId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()

        try {
            const order = await Order.query({ client: effectiveTrx })
                .where('id', orderId)
                .forUpdate()
                .first()

            if (!order || order.status !== 'PENDING') {
                throw new Error('Mission is no longer available')
            }

            // Document Compliance Check
            const CompanyDriverSetting = (await import('#models/company_driver_setting')).default
            const DriverSetting = (await import('#models/driver_setting')).default
            const ds = await DriverSetting.findBy('userId', driverId)

            if (ds?.currentCompanyId) {
                const cds = await CompanyDriverSetting.query()
                    .where('companyId', ds.currentCompanyId)
                    .where('driverId', driverId)
                    .first()

                if (cds && cds.docsStatus !== 'APPROVED') {
                    throw new Error('Votre dossier est incomplet ou contient des documents rejetés.')
                }
            }

            // Assign driver and update status
            order.driverId = driverId
            order.offeredDriverId = null
            order.offerExpiresAt = null
            order.status = 'ACCEPTED'

            // HISTORY
            order.statusHistory = [
                ...(order.statusHistory || []),
                { status: 'ACCEPTED', timestamp: DateTime.now().toISO()!, note: 'Accepted by driver' }
            ]

            // CAPTURE INITIAL DRIVER POSITION
            const driverState = await RedisService.getDriverState(driverId)
            if (driverState?.last_lat && driverState?.last_lng) {
                await updateMetadataField(order, 'metadata', {
                    lat: driverState.last_lat,
                    lng: driverState.last_lng,
                    timestamp: DateTime.now().toISO()!,
                    address: ''
                }, 'initial_driver_position')
            }

            await order.useTransaction(effectiveTrx).save()

            // Redis Warmup
            await order.load('stops', (q) => q.orderBy('display_order', 'desc').limit(1).preload('address'))
            const lastStop = order.stops[0]

            if (lastStop?.address) {
                await RedisService.addOrderToDriver(driverId, orderId, {
                    lat: lastStop.address.lat,
                    lng: lastStop.address.lng
                })
            }

            // Register after('commit') BEFORE committing
            (effectiveTrx as any).after('commit', () => {
                emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                    orderId: order.id,
                    status: order.status,
                    clientId: order.clientId
                }))
            })

            if (!trx) await effectiveTrx.commit()

            return order
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            logger.error({ err: error }, 'Mission acceptance failed')
            throw error
        }
    }

    /**
     * Driver signals arrival at a stop.
     */
    async arrivedAtStop(driverId: string, stopId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const stop = await Stop.query({ client: effectiveTrx })
                .where('id', stopId)
                .preload('order' as any)
                .forUpdate()
                .firstOrFail()

            if (stop.order.driverId !== driverId) {
                throw new Error('Stop not assigned to you')
            }

            if (stop.status === 'PENDING') {
                // 1. GPS PROXIMITY VALIDATION
                const driverState = await RedisService.getDriverState(driverId)
                if (driverState?.last_lat && driverState?.last_lng) {
                    await stop.load('address')
                    if (stop.address) {
                        const distance = getDistance(
                            driverState.last_lat,
                            driverState.last_lng,
                            stop.address.lat,
                            stop.address.lng
                        )

                        // if (distance > logisticsConfig.validation.stopArrivalProximityMeters) {
                        //     throw new Error(`Vous êtes trop loin de l'arrêt (${Math.round(distance)}m). La limite est de ${logisticsConfig.validation.stopArrivalProximityMeters}m.`)
                        // }
                    }
                }

                stop.status = 'ARRIVED'
                stop.arrivalTime = DateTime.now()

                // HISTORY
                // stop.statusHistory = [
                //     ...(stop.statusHistory || []),
                //     { status: 'ARRIVED', timestamp: DateTime.now().toISO()!, note: 'Driver arrived at location' }
                // ]

                await stop.useTransaction(effectiveTrx).save();

                // SOCKET (DEFERRED)
                (effectiveTrx as any).after('commit', () => {
                    emitter.emit(StopStatusUpdated, new StopStatusUpdated({
                        stopId: stop.id,
                        status: stop.status,
                        orderId: stop.orderId
                    }))
                })

                // PROGRESS TRACKING: Update metadata execution lists
                const order = stop.order
                const meta = order.metadata || {}
                if (meta.route_execution) {
                    const remaining = [...(meta.route_execution.remaining || [])]
                    const visited = [...(meta.route_execution.visited || [])]

                    // Move from remaining to visited
                    const index = remaining.indexOf(stopId)
                    if (index !== -1) {
                        remaining.splice(index, 1)
                    }
                    if (!visited.includes(stopId)) {
                        visited.push(stopId)
                    }

                    // atomic update of the route_execution object
                    await updateMetadataField(order, 'metadata', {
                        ...meta.route_execution,
                        remaining,
                        visited
                    }, 'route_execution')

                    await order.useTransaction(effectiveTrx).save()
                }

                await this.syncOrderStatus(stop.orderId, effectiveTrx);

                const leg = await OrderLeg.query({ client: effectiveTrx })
                    .where('orderId', stop.orderId)
                    .first()

                if (leg) {
                    const RouteService = (await import('#services/route_service')).default
                    await RouteService.flushTraceToLeg(stop.orderId, leg.id, effectiveTrx)

                    leg.status = 'COMPLETED'
                    await leg.useTransaction(effectiveTrx).save()
                }
            }

            if (!trx) await effectiveTrx.commit()

            return stop
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Completes a specific action with proof validation.
     * proofs: Record<key, value> (e.g. { verify_otp: "123456" })
     * files: Array of MultipartFile (from request.allFiles() flattened)
     */
    async completeAction(driverId: string, actionId: string, proofs: Record<string, string> = {}, files: MultipartFile[] = [], trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const action = await Action.query({ client: effectiveTrx })
                .where('id', actionId)
                .preload('proofs')
                .forUpdate()
                .firstOrFail()

            if (action.status === 'COMPLETED') {
                if (!trx) await effectiveTrx.commit()
                return action
            }

            // 1. Sequence Enforcement
            const stop = await Stop.find(action.stopId, { client: effectiveTrx })
            if (!stop || (stop.status !== 'ARRIVED' && stop.status !== 'PARTIAL')) {
                if (stop?.status === 'PENDING') {
                    throw new Error('You must signal arrival at the stop before completing actions')
                }
            }

            // 2. Validate Proofs
            for (const proof of action.proofs) {
                const submittedValue = proofs[proof.key]

                if (proof.type === 'CODE') {
                    if (proof.metadata?.compare) {
                        if (!submittedValue || submittedValue !== proof.expectedValue) {
                            throw new Error(`Invalid or missing code for proof: ${proof.key}`)
                        }
                    }
                    proof.submittedValue = submittedValue
                    proof.isVerified = true
                } else if (proof.type === 'PHOTO') {
                    const relevantFiles = files.filter(f => f.fieldName === proof.key)

                    if (relevantFiles.length > 0) {
                        const manager = new FileManager(proof, 'ActionProof')
                        await manager.uploadFiles(relevantFiles, {
                            column: proof.key,
                            config: { maxFiles: 1, allowedExt: ['jpg', 'png', 'jpeg', 'pdf'] }
                        }, driverId)

                        const uploadedFile = await File.query({ client: effectiveTrx })
                            .where('tableName', 'ActionProof')
                            .where('tableId', proof.id)
                            .where('tableColumn', proof.key)
                            .orderBy('createdAt', 'desc')
                            .first()

                        if (uploadedFile) {
                            proof.submittedValue = uploadedFile.id
                            proof.isVerified = true
                        }
                    }

                    if (!proof.isVerified) {
                        if (!submittedValue) {
                            throw new Error(`Missing required file/proof for: ${proof.key}`)
                        }
                        proof.submittedValue = submittedValue
                        proof.isVerified = true
                    }
                }
                await proof.useTransaction(effectiveTrx).save()
            }

            const allVerified = action.proofs.every(p => p.isVerified)
            if (!allVerified) {
                throw new Error('Some required proofs are missing or invalid')
            }

            action.status = 'COMPLETED'

            // HISTORY
            // action.statusHistory = [
            //     ...(action.statusHistory || []),
            //     { status: 'COMPLETED', timestamp: DateTime.now().toISO()!, note: 'Action completed successfully' }
            // ]

            await action.useTransaction(effectiveTrx).save()

            await this.syncStopProgress(action.stopId, effectiveTrx)
            await this.syncOrderStatus(action.orderId, effectiveTrx)

            // SOCKET
            const updatedOrder = await Order.findOrFail(action.orderId, { client: effectiveTrx });

            // Register after('commit') BEFORE committing
            (effectiveTrx as any).after('commit', () => {
                emitter.emit(ActionStatusUpdated, new ActionStatusUpdated({
                    actionId: action.id,
                    status: action.status,
                    orderId: action.orderId
                }));

                emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                    orderId: action.orderId,
                    status: updatedOrder.status,
                    clientId: updatedOrder.clientId
                }));
            });

            if (!trx) await effectiveTrx.commit()

            return action
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Freeze an action (e.g. absent, refused, later).
     */
    async freezeAction(_driverId: string, actionId: string, reason?: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const action = await Action.query({ client: effectiveTrx })
                .where('id', actionId)
                .forUpdate()
                .firstOrFail()

            if (['COMPLETED', 'FROZEN'].includes(action.status)) {
                if (!trx) await effectiveTrx.commit()
                return action
            }

            const stop = await Stop.find(action.stopId, { client: effectiveTrx })
            if (!stop || (stop.status !== 'ARRIVED' && stop.status !== 'PARTIAL')) {
                if (stop?.status === 'PENDING') {
                    throw new Error('You must signal arrival at the stop before freezing actions')
                }
            }

            action.status = 'FROZEN'
            if (reason) {
                action.metadata = { ...action.metadata, freezeReason: reason }
            }

            // HISTORY
            // action.statusHistory = [
            //     ...(action.statusHistory || []),
            //     { status: 'FROZEN', timestamp: DateTime.now().toISO()!, note: reason || 'Action frozen' }
            // ]

            await action.useTransaction(effectiveTrx).save()

            await this.syncStopProgress(action.stopId, effectiveTrx)
            await this.syncOrderStatus(action.orderId, effectiveTrx)

            // SOCKET
            const updatedOrder = await Order.findOrFail(action.orderId, { client: effectiveTrx });
            // Register after('commit') BEFORE committing
            (effectiveTrx as any).after('commit', () => {
                emitter.emit(ActionStatusUpdated, new ActionStatusUpdated({
                    actionId: action.id,
                    status: action.status,
                    orderId: action.orderId
                }));

                emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                    orderId: action.orderId,
                    status: updatedOrder.status,
                    clientId: updatedOrder.clientId
                }));
            });

            if (!trx) await effectiveTrx.commit()

            return action
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Freeze all pending actions in a stop.
     */
    async freezeStop(driverId: string, stopId: string, reason?: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const stop = await Stop.query({ client: effectiveTrx })
                .where('id', stopId)
                .preload('actions')
                .preload('order' as any)
                .forUpdate()
                .firstOrFail()

            if (stop.order.driverId !== driverId) {
                throw new Error('Stop not assigned to you')
            }

            for (const action of stop.actions) {
                if (action.status === 'PENDING' || action.status === 'ARRIVED') {
                    action.status = 'FROZEN'
                    if (reason) {
                        action.metadata = { ...action.metadata, freezeReason: reason }
                    }

                    // HISTORY
                    // action.statusHistory = [
                    //     ...(action.statusHistory || []),
                    //     { status: 'FROZEN', timestamp: DateTime.now().toISO()!, note: reason || 'Stop level freeze' }
                    // ]
                    await action.useTransaction(effectiveTrx).save();

                    // SOCKET (DEFERRED)
                    const currentActionId = action.id
                    const currentActionStatus = action.status
                    const currentActionOrderId = action.orderId;
                    (effectiveTrx as any).after('commit', () => {
                        emitter.emit(ActionStatusUpdated, new ActionStatusUpdated({
                            actionId: currentActionId,
                            status: currentActionStatus,
                            orderId: currentActionOrderId
                        }))
                    });
                }
            }

            await this.syncStopProgress(stop.id, effectiveTrx)
            await this.syncOrderStatus(stop.orderId, effectiveTrx)

            if (!trx) await effectiveTrx.commit()
            return stop
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Unfreeze/Reactivate an action.
     */
    async unfreezeAction(_driverId: string, actionId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const action = await Action.query({ client: effectiveTrx })
                .where('id', actionId)
                .forUpdate()
                .firstOrFail()

            if (action.status !== 'FROZEN') {
                if (!trx) await effectiveTrx.commit()
                return action
            }

            action.status = 'PENDING'
            if (action.metadata?.freezeReason) {
                const meta = { ...action.metadata }
                delete meta.freezeReason
                action.metadata = meta
            }

            // HISTORY
            // action.statusHistory = [
            //     ...(action.statusHistory || []),
            //     { status: 'PENDING', timestamp: DateTime.now().toISO()!, note: 'Action reactivated' }
            // ]

            await action.useTransaction(effectiveTrx).save();

            await this.syncStopProgress(action.stopId, effectiveTrx);
            await this.syncOrderStatus(action.orderId, effectiveTrx);

            // SOCKET
            (effectiveTrx as any).after('commit', () => {
                emitter.emit(ActionStatusUpdated, new ActionStatusUpdated({
                    actionId: action.id,
                    status: action.status,
                    orderId: action.orderId
                }))
            });

            if (!trx) await effectiveTrx.commit()
            return action
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Unfreeze/Reactivate all actions in a stop.
     */
    async unfreezeStop(driverId: string, stopId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const stop = await Stop.query({ client: effectiveTrx })
                .where('id', stopId)
                .preload('actions')
                .preload('order' as any)
                .forUpdate()
                .firstOrFail()

            if (stop.order.driverId !== driverId) {
                throw new Error('Stop not assigned to you')
            }

            for (const action of stop.actions) {
                if (action.status === 'FROZEN') {
                    action.status = 'PENDING'
                    if (action.metadata?.freezeReason) {
                        const meta = { ...action.metadata }
                        delete meta.freezeReason
                        action.metadata = meta
                    }
                    await action.useTransaction(effectiveTrx).save();

                    // SOCKET
                    const currentActionId = action.id
                    const currentActionStatus = action.status
                    const currentActionOrderId = action.orderId;
                    (effectiveTrx as any).after('commit', () => {
                        emitter.emit(ActionStatusUpdated, new ActionStatusUpdated({
                            actionId: currentActionId,
                            status: currentActionStatus,
                            orderId: currentActionOrderId
                        }))
                    });
                }
            }

            await this.syncStopProgress(stop.id, effectiveTrx)
            await this.syncOrderStatus(stop.orderId, effectiveTrx)

            if (!trx) await effectiveTrx.commit()
            return stop
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Manually mark a stop as finished (e.g. driver leaving location).
     * Only works if all actions are terminal.
     */
    async completeStop(driverId: string, stopId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const stop = await Stop.query({ client: effectiveTrx })
                .where('id', stopId)
                .preload('actions')
                .preload('order' as any)
                .forUpdate()
                .firstOrFail()

            if (stop.order.driverId !== driverId) {
                throw new Error('Stop not assigned to you')
            }

            const allTerminal = stop.actions.every(a => ['COMPLETED', 'FROZEN', 'CANCELLED', 'FAILED'].includes(a.status))
            if (!allTerminal) {
                throw new Error('All actions must be completed or frozen before finishing the stop')
            }

            await this.syncStopProgress(stop.id, effectiveTrx)
            await this.syncOrderStatus(stop.orderId, effectiveTrx)

            if (!trx) await effectiveTrx.commit()
            return stop
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Mark the entire mission as finished once all actions are terminal.
     */
    async completeOrder(driverId: string, orderId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const order = await Order.query({ client: effectiveTrx })
                .where('id', orderId)
                .preload('stops', (q) => q.preload('actions'))
                .forUpdate()
                .firstOrFail()

            if (order.driverId !== driverId) {
                throw new Error('Order not assigned to you')
            }

            const allActions = order.stops.flatMap(s => s.actions)
            const allTerminal = allActions.every(a => ['COMPLETED', 'FROZEN', 'CANCELLED', 'FAILED'].includes(a.status))

            if (!allTerminal) {
                throw new Error('All actions in the order must be completed or frozen before finishing')
            }

            await this.syncOrderStatus(order.id, effectiveTrx, { force: true })

            if (!trx) await effectiveTrx.commit()
            return await Order.findOrFail(orderId)
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Helper to sync stop status based on its actions.
     */
    private async syncStopProgress(stopId: string, trx: TransactionClientContract) {
        const stop = await Stop.find(stopId, { client: trx })
        if (!stop) return

        const actions = await Action.query({ client: trx }).where('stopId', stopId)

        const allTerminal = actions.every(a => ['COMPLETED', 'FROZEN', 'CANCELLED', 'FAILED'].includes(a.status))
        const anyFrozenOrFailed = actions.some(a => ['FROZEN', 'FAILED', 'CANCELLED'].includes(a.status))

        if (allTerminal && actions.length > 0) {
            let newStatus: 'COMPLETED' | 'PARTIAL' | 'FAILED' = 'COMPLETED'
            if (anyFrozenOrFailed) {
                newStatus = 'PARTIAL'
            }

            if (stop.status !== newStatus) {
                stop.status = newStatus
                stop.completionTime = DateTime.now()

                // HISTORY
                // stop.statusHistory = [
                //     ...(stop.statusHistory || []),
                //     { status: newStatus, timestamp: DateTime.now().toISO()!, note: 'Stop auto-sync via Actions' }
                // ]

                await stop.useTransaction(trx).save();

                // SOCKET
                (trx as any).after('commit', () => {
                    emitter.emit(StopStatusUpdated, new StopStatusUpdated({
                        stopId: stop.id,
                        status: stop.status,
                        orderId: stop.orderId
                    }));
                });
            }

            const step = await Step.find(stop.stepId, { client: trx })
            if (step) {
                const stopsInStep = await Stop.query({ client: trx }).where('stepId', step.id)
                const allStopsTerminal = stopsInStep.every(s => ['COMPLETED', 'PARTIAL', 'FAILED'].includes(s.status))

                if (allStopsTerminal) {
                    step.status = 'COMPLETED'
                    await step.useTransaction(trx).save()

                    // --- HYBRID TRACE: FREEZE ACTUAL PATH ---
                    await this.freezeActualPath(stop.id, trx)

                    // --- RECALCULATE REMAINING ROUTE ---
                    const freshOrder = await Order.find(stop.orderId, { client: trx })
                    if (freshOrder) {
                        try {
                            await this.orderDraftService.calculateOrderStats(freshOrder, trx)
                        } catch (err) {
                            logger.error({ err, orderId: freshOrder.id }, 'Recalculation failed after stop completion')
                        }
                    }
                } else {
                    step.status = 'IN_PROGRESS'
                    await step.useTransaction(trx).save()
                }
            }
        }
    }

    /**
     * Congèle la trace réelle parcourue pour un segment de stop qui vient de se terminer.
     */
    private async freezeActualPath(stopId: string, trx: TransactionClientContract) {
        try {
            const stop = await Stop.query({ client: trx }).where('id', stopId).preload('order' as any).first()
            if (!stop || !stop.order) return

            // 1. Récupérer la trace en buffer Redis
            const rawTrace = await RedisService.getOrderTrace(stop.orderId)
            if (!rawTrace || rawTrace.length === 0) return

            // 2. Compresser la trace
            const compressed = GeoCompressor.compressTrace(rawTrace)

            // 3. Récupérer le OrderLeg
            let leg = await OrderLeg.query({ client: trx }).where('orderId', stop.orderId).first()
            if (!leg) {
                leg = await OrderLeg.create({ orderId: stop.orderId, status: 'IN_TRANSIT' }, { client: trx })
            }

            // 4. Ajouter à actualPath existant
            const currentPath = leg.actualPath?.coordinates || []
            const newPoints = compressed.map(p => [p[0], p[1]])

            leg.actualPath = {
                type: 'LineString',
                coordinates: [...currentPath, ...newPoints]
            }

            await leg.useTransaction(trx).save()

            // 5. Nettoyer le buffer Redis pour le segment suivant
            await RedisService.clearOrderTraceAfterFlush(stop.orderId)

            logger.info({ stopId, points: compressed.length }, 'Actual path frozen for stop')
        } catch (error) {
            logger.error({ error, stopId }, 'Failed to freeze actual path')
        }
    }

    /**
     * Main logic to derive global Order status from atomic progress.
     */
    async syncOrderStatus(orderId: string, trx?: TransactionClientContract, options: { force?: boolean } = {}) {
        const effectiveTrx = trx || await db.transaction()

        try {
            const order = await Order.find(orderId, { client: effectiveTrx })
            if (!order) {
                if (!trx) await effectiveTrx.commit()
                return
            }

            const stops = await Stop.query({ client: effectiveTrx }).where('orderId', orderId)
            const plannedOrder = order.metadata?.route_execution?.planned as string[] | undefined
            if (plannedOrder && plannedOrder.length > 0) {
                stops.sort((a, b) => plannedOrder.indexOf(a.id) - plannedOrder.indexOf(b.id))
            } else {
                stops.sort((a, b) => (a.executionOrder ?? a.displayOrder) - (b.executionOrder ?? b.displayOrder))
            }
            const actions = await Action.query({ client: effectiveTrx }).where('orderId', orderId)

            let newStatus = order.status

            const deliveryActions = actions.filter(a => a.type === 'DELIVERY')
            const allActionsTerminal = actions.every(a => ['COMPLETED', 'FROZEN', 'CANCELLED', 'FAILED'].includes(a.status))
            const anyActionFrozen = actions.some(a => a.status === 'FROZEN')

            // Auto-sync should only close the order if ALL actions are terminal AND none are FROZEN.
            // If something is FROZEN, it stays ACCEPTED so the driver can manage (unfreeze/skip) 
            // before manually finishing the mission.
            if (allActionsTerminal && (options.force || !anyActionFrozen) && actions.length > 0) {
                const anyDeliveryCompleted = deliveryActions.some(a => a.status === 'COMPLETED')

                if (deliveryActions.length > 0) {
                    if (anyDeliveryCompleted) {
                        newStatus = 'DELIVERED'
                    } else {
                        newStatus = 'FAILED'
                    }
                } else {
                    // Service/Pickup only orders
                    newStatus = 'DELIVERED'
                }
            }

            if (newStatus !== order.status) {
                order.status = newStatus as any

                // HISTORY
                order.statusHistory = [
                    ...(order.statusHistory || []),
                    { status: newStatus, timestamp: DateTime.now().toISO()!, note: 'Auto-sync via Action-Centric Workflow' }
                ]

                await order.useTransaction(effectiveTrx).save();

                if (['DELIVERED', 'FAILED', 'CANCELLED'].includes(newStatus)) {
                    if (order.driverId) {
                        await RedisService.removeOrderFromDriver(order.driverId, orderId)
                    }
                }

                // SOCKET
                (effectiveTrx as any).after('commit', () => {
                    emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                        orderId: order.id,
                        status: order.status,
                        clientId: order.clientId
                    }))
                });
            }

            if (!trx) await effectiveTrx.commit()
        } catch (e) {
            if (!trx) await effectiveTrx.rollback()
            throw e
        }
    }

    /**
     * List missions for a driver (active or offered).
     * Filter: 'active' | 'pending' | 'history'
     */
    /**
     * List missions for a driver (active or offered).
     * Filter: 'active' | 'pending' | 'history'
     * Pagination: page, limit
     */
    /**
     * Get a single mission by ID with full details
     */
    async getMission(driverId: string, missionId: string) {
        const order = await Order.query()
            .where('id', missionId)
            // Ensure the driver has access to this mission (assigned or offered)
            .where((q) => {
                q.where('driverId', driverId)
                q.orWhere((pendingQ) => {
                    pendingQ.where('status', 'PENDING')
                    pendingQ.where((subQ) => {
                        // Direct assignment (TARGET)
                        subQ.orWhere((targetQ) => {
                            targetQ.where('assignmentMode', 'TARGET')
                            targetQ.where('refId', driverId)
                        })
                        // We skip GLOBAL check for getMission to simplify, assuming if they have the ID they might be authorized
                        // But for strict security we could re-implement the company check if needed.
                        // For now, let's allow if they are the driver OR if it's pending/target for them.
                    })
                })
            })
            .preload('client', (q) => q.preload('company'))
            .preload('transitItems')
            .preload('steps', (stepsQuery) => {
                stepsQuery.orderBy('sequence', 'asc')
                stepsQuery.preload('stops', (stopsQuery) => {
                    stopsQuery.where('isPendingChange', false)
                    stopsQuery.orderBy('execution_order', 'asc')
                    stopsQuery.preload('actions', (actionsQuery) => {
                        actionsQuery.where('isPendingChange', false)
                    })
                    stopsQuery.preload('address')
                })
            })
            .firstOrFail()

        return order
    }

    async listMissions(driverId: string, filter?: string, page?: number, limit?: number) {
        const DriverSetting = (await import('#models/driver_setting')).default
        const ds = await DriverSetting.findBy('userId', driverId)

        const query = Order.query()
            .where((q) => {
                // FILTER: PENDING (Offers)
                if (!filter || filter === 'pending') {
                    q.orWhere((pendingQ) => {
                        pendingQ.where('status', 'PENDING')
                        pendingQ.where((subQ) => {
                            // Direct assignment (TARGET)
                            subQ.orWhere((targetQ) => {
                                targetQ.where('assignmentMode', 'TARGET')
                                targetQ.where('refId', driverId)
                            })
                            // Global assignment (GLOBAL + Company Check)
                            subQ.orWhere((globalQ) => {
                                globalQ.where('assignmentMode', 'GLOBAL')
                                if (ds?.currentCompanyId) {
                                    globalQ.whereHas('client', (clientQ) => {
                                        clientQ.where('companyId', ds.currentCompanyId!)
                                    })
                                }
                            })
                        })
                        // Ensure NOT already assigned to someone else (though status=PENDING usually implies this)
                        pendingQ.whereNull('driverId')
                    })
                }

                // FILTER: ACTIVE (My current missions)
                if (!filter || filter === 'active') {
                    q.orWhere((activeQ) => {
                        activeQ.where('driverId', driverId)
                        activeQ.whereIn('status', ['ACCEPTED', 'IN_PROGRESS', 'AT_PICKUP', 'COLLECTED', 'AT_DELIVERY'])
                    })
                }

                // FILTER: HISTORY (My past missions)
                if (!filter || filter === 'history') {
                    q.orWhere((historyQ) => {
                        historyQ.where('driverId', driverId)
                        historyQ.whereIn('status', ['DELIVERED', 'COMPLETED', 'CANCELLED', 'FAILED'])
                    })
                }
            })
            .preload('client', (q) => q.preload('company'))
            .preload('transitItems')
            .preload('steps', (stepsQuery) => {
                stepsQuery.orderBy('sequence', 'asc')
                stepsQuery.preload('stops', (stopsQuery) => {
                    stopsQuery.where('isPendingChange', false) // Filter out shadow (edited) stops
                    stopsQuery.orderBy('execution_order', 'asc')
                    stopsQuery.preload('actions', (actionsQuery) => {
                        actionsQuery.where('isPendingChange', false)
                    })
                    stopsQuery.preload('address')
                })
            })
            .orderBy('createdAt', 'desc')

        // Executing query
        let orders: Order[]
        let meta: any = null

        if (page && limit) {
            const paginated = await query.paginate(page, limit)
            orders = paginated.all()
            meta = paginated.getMeta()
        } else {
            orders = await query.exec()
        }

        for (const order of orders) {
            const execution = order.metadata?.route_execution
            const plannedOrder = execution?.planned as string[] | undefined

            if (plannedOrder && plannedOrder.length > 0) {
                order.steps.sort((a, b) => {
                    const stopA = a.stops?.[0]
                    const stopB = b.stops?.[0]
                    if (!stopA || !stopB) return 0
                    return (stopA.executionOrder ?? stopA.displayOrder) - (stopB.executionOrder ?? stopB.displayOrder)
                })

                for (const step of order.steps) {
                    if (step.stops) {
                        step.stops.sort((a, b) => (a.executionOrder ?? a.displayOrder) - (b.executionOrder ?? b.displayOrder))
                    }
                }
            }
        }

        if (page && limit) {
            return { data: orders, meta }
        }

        return orders
    }

    /**
     * Verify a pickup/delivery code on a leg.
     */
    async verifyCode(orderId: string, code: string, trx?: TransactionClientContract) {
        if (!isValidCodeFormat(code)) {
            throw new Error('Invalid code format. Must be 6 digits.')
        }

        const effectiveTrx = trx || await db.transaction()
        try {
            const leg = await OrderLeg.query({ client: effectiveTrx })
                .where('orderId', orderId)
                .where('verificationCode', code)
                .forUpdate()
                .first()

            if (!leg) {
                throw new Error('Invalid or already used verification code')
            }

            leg.status = 'COMPLETED'
            await leg.useTransaction(effectiveTrx).save()
            if (!trx) await effectiveTrx.commit()

            return leg
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
    }

    /**
     * Driver refuses a mission.
     */
    async refuseMission(driverId: string, orderId: string, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            const order = await Order.query({ client: effectiveTrx })
                .where('id', orderId)
                .forUpdate()
                .first()

            if (order && order.offeredDriverId === driverId) {
                await this.dispatchService.registerRejection(orderId, driverId)
                order.offeredDriverId = null
                order.offerExpiresAt = null
                await order.useTransaction(effectiveTrx).save()

                const state = await RedisService.getDriverState(driverId)
                if (state && state.status === 'OFFERING') {
                    await RedisService.updateDriverState(driverId, { status: 'ONLINE' })
                }
                if (!trx) await effectiveTrx.commit()

                this.dispatchService.dispatch(order).catch(err => {
                    logger.error({ err, orderId }, 'Dispatch failed after refusal')
                })
            } else {
                if (!trx) await effectiveTrx.commit()
            }
        } catch (error) {
            if (!trx) await effectiveTrx.rollback()
            throw error
        }
        return true
    }

    /**
     * Legacy/Support status update.
     */
    async updateStatus(orderId: string, driverId: string, status: string, _options: { latitude?: number, longitude?: number, reason?: string }, trx?: TransactionClientContract) {
        const effectiveTrx = trx || await db.transaction()
        try {
            if (['CANCELLED', 'FAILED'].includes(status)) {
                const order = await Order.query({ client: effectiveTrx }).where('id', orderId).andWhere('driverId', driverId).firstOrFail()
                order.status = status as any

                // HISTORY
                order.statusHistory = [
                    ...(order.statusHistory || []),
                    { status: order.status, timestamp: DateTime.now().toISO()!, note: _options.reason || 'Manual override' }
                ]

                await order.useTransaction(effectiveTrx).save()
                await RedisService.removeOrderFromDriver(driverId, orderId)

                if (!trx) await effectiveTrx.commit()

                // SOCKET
                emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                    orderId: order.id,
                    status: order.status,
                    clientId: order.clientId
                }))

                return order
            }
            throw new Error('Please use arrivedAtStop/completeAction for normal workflow progression')
        } catch (e) {
            if (!trx) await effectiveTrx.rollback()
            throw e
        }
    }
}
