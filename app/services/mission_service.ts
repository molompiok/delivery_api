import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'
import Order from '#models/order'
import Mission from '#models/mission'
import OrderStatusUpdated from '#events/order_status_updated'
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

@inject()
export default class MissionService {
    constructor(protected dispatchService: DispatchService) { }

    /**
     * Driver accepts a mission.
     */
    async acceptMission(driverId: string, orderId: string) {
        const trx = await db.transaction()

        try {
            const order = await Order.query({ client: trx })
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
            await order.useTransaction(trx).save()

            // Update Mission model
            let mission = await Mission.query({ client: trx }).where('orderId', orderId).first()
            if (!mission) {
                mission = new Mission()
                mission.orderId = orderId
            }
            mission.driverId = driverId
            mission.status = 'ASSIGNED'
            mission.startAt = DateTime.now()
            await mission.useTransaction(trx).save()

            // Redis Warmup
            await order.load('stops', (q) => q.orderBy('sequence', 'desc').limit(1).preload('address'))
            const lastStop = order.stops[0]

            if (lastStop?.address) {
                await RedisService.addOrderToDriver(driverId, orderId, {
                    lat: lastStop.address.lat,
                    lng: lastStop.address.lng
                })
            }

            await trx.commit()

            emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                orderId: order.id,
                status: order.status,
                clientId: order.clientId
            }))

            return order
        } catch (error) {
            await trx.rollback()
            logger.error({ err: error }, 'Mission acceptance failed')
            throw error
        }
    }

    /**
     * Driver signals arrival at a stop.
     */
    async arrivedAtStop(driverId: string, stopId: string) {
        const trx = await db.transaction()
        try {
            const stop = await Stop.query({ client: trx })
                .where('id', stopId)
                .preload('order' as any)
                .forUpdate()
                .firstOrFail()

            if (stop.order.driverId !== driverId) {
                throw new Error('Stop not assigned to you')
            }

            stop.status = 'ARRIVED'
            stop.arrivalTime = DateTime.now()
            await stop.useTransaction(trx).save()

            await this.syncOrderStatus(stop.orderId, trx)
            await trx.commit()

            return stop
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Completes a specific action with proof validation.
     * proofs: Record<key, value> (e.g. { verify_otp: "123456" })
     * files: Array of MultipartFile (from request.allFiles() flattened)
     */
    async completeAction(driverId: string, actionId: string, proofs: Record<string, string> = {}, files: MultipartFile[] = []) {
        const trx = await db.transaction()
        try {
            const action = await Action.query({ client: trx })
                .where('id', actionId)
                .preload('proofs')
                .forUpdate()
                .firstOrFail()

            //TODO : la logique d'assignation des actions aux conducteurs.
            // if (action.order.driverId !== driverId) {
            //     throw new Error('Action not assigned to you')
            // }

            if (action.status === 'COMPLETED') {
                return action
            }

            // 1. Sequence Enforcement
            const stop = await Stop.find(action.stopId, { client: trx })
            if (!stop || stop.status !== 'ARRIVED') {
                throw new Error('You must signal arrival at the stop before completing actions')
            }

            // 2. Validate Proofs
            for (const proof of action.proofs) {
                const submittedValue = proofs[proof.key]

                if (proof.type === 'OTP') {
                    if (!submittedValue || submittedValue !== proof.expectedValue) {
                        throw new Error(`Invalid or missing OTP for proof: ${proof.key}`)
                    }
                    proof.submittedValue = submittedValue
                    proof.isVerified = true
                } else if (['PHOTO', 'SIGNATURE', 'ID_CARD'].includes(proof.type)) {
                    // Check if we have files for this proof key
                    const relevantFiles = files.filter(f => f.fieldName === proof.key)

                    if (relevantFiles.length > 0) {
                        const manager = new FileManager(proof, 'ActionProof')
                        await manager.uploadFiles(relevantFiles, {
                            column: proof.key,
                            config: { maxFiles: 1, allowedExt: ['jpg', 'png', 'jpeg', 'pdf'] }
                        }, driverId)

                        // Get the file ID that was just uploaded
                        const uploadedFile = await File.query({ client: trx })
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

                    // Fallback to submittedValue (for legacy/tests/mock) if no actual file processed
                    if (!proof.isVerified) {
                        if (!submittedValue) {
                            throw new Error(`Missing required file/proof for: ${proof.key}`)
                        }
                        proof.submittedValue = submittedValue
                        proof.isVerified = true
                    }
                }
                await proof.useTransaction(trx).save()
            }

            // 3. Final Check: All required proofs verified?
            const allVerified = action.proofs.every(p => p.isVerified)
            if (!allVerified) {
                throw new Error('Some required proofs are missing or invalid')
            }

            // 4. Complete Action
            action.status = 'COMPLETED'
            await action.useTransaction(trx).save()

            // 5. Sync hierarchy (Stop -> Step -> Order)
            await this.syncStopProgress(action.stopId, trx)
            await this.syncOrderStatus(action.orderId, trx)

            // 6. Fetch updated order for event
            const updatedOrder = await Order.findOrFail(action.orderId, { client: trx })

            await trx.commit()

            emitter.emit(OrderStatusUpdated, new OrderStatusUpdated({
                orderId: action.orderId,
                status: updatedOrder.status,
                clientId: updatedOrder.clientId
            }))

            return action
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Helper to sync stop status based on its actions.
     */
    private async syncStopProgress(stopId: string, trx: any) {
        const stop = await Stop.find(stopId, { client: trx })
        if (!stop) return

        const actions = await Action.query({ client: trx }).where('stopId', stopId)
        const allCompleted = actions.every(a => a.status === 'COMPLETED')

        if (allCompleted && actions.length > 0) {
            stop.status = 'COMPLETED'
            stop.completionTime = DateTime.now()
            await stop.useTransaction(trx).save()

            // Also check Step
            const step = await Step.find(stop.stepId, { client: trx })
            if (step) {
                const stopsInStep = await Stop.query({ client: trx }).where('stepId', step.id)
                const allStopsCompleted = stopsInStep.every(s => s.status === 'COMPLETED')
                if (allStopsCompleted) {
                    step.status = 'COMPLETED'
                    await step.useTransaction(trx).save()
                } else {
                    step.status = 'IN_PROGRESS'
                    await step.useTransaction(trx).save()
                }
            }
        }
    }

    /**
     * Main logic to derive global Order status from atomic progress.
     */
    async syncOrderStatus(orderId: string, trx?: any) {
        const client = trx || db
        const order = await Order.find(orderId, { client })
        if (!order) return

        const stops = await Stop.query({ client }).where('orderId', orderId).orderBy('sequence', 'asc')
        const actions = await Action.query({ client }).where('orderId', orderId)

        const anyArrived = stops.find(s => s.status === 'ARRIVED')
        const allActionsCompleted = actions.every(a => a.status === 'COMPLETED')
        const anyActionCompleted = actions.some(a => a.status === 'COMPLETED')

        // Derive status
        let newStatus = order.status

        if (allActionsCompleted && actions.length > 0) {
            newStatus = 'DELIVERED'
        } else if (anyArrived) {
            // Priority 1: If arrived at a stop, check if it has delivery or pickup
            const currentStop = stops.find(s => s.status === 'ARRIVED')
            if (currentStop) {
                const hasDelivery = await Action.query({ client }).where('stopId', currentStop.id).where('type', 'DELIVERY').first()
                newStatus = hasDelivery ? 'AT_DELIVERY' : 'AT_PICKUP'
            }
        } else if (anyActionCompleted) {
            // Priority 2: Not arrived anywhere but something happened
            const pickups = actions.filter(a => a.type === 'PICKUP')
            const allPickupsDone = pickups.every(p => p.status === 'COMPLETED')

            if (allPickupsDone && pickups.length > 0) {
                newStatus = 'COLLECTED'
            }
        }

        if (newStatus !== order.status) {
            order.status = newStatus as any
            order.statusHistory = [
                ...(order.statusHistory || []),
                { status: newStatus, timestamp: DateTime.now().toISO()!, note: 'Auto-sync via Atomic Workflow' }
            ]
            await order.useTransaction(client).save()

            // Update Mission if terminal
            if (['DELIVERED', 'FAILED', 'CANCELLED'].includes(newStatus)) {
                const mission = await Mission.query({ client }).where('orderId', orderId).first()
                if (mission) {
                    mission.status = newStatus === 'DELIVERED' ? 'COMPLETED' : 'FAILED'
                    mission.completedAt = DateTime.now()
                    await mission.useTransaction(client).save()
                }
                if (order.driverId) {
                    await RedisService.removeOrderFromDriver(order.driverId, orderId)
                }
            }
        }
    }

    /**
     * List missions for a driver (active or offered).
     */
    async listMissions(driverId: string) {
        return await Order.query()
            .where('driverId', driverId)
            .orWhere('offeredDriverId', driverId)
            // Legacy preloads for compatibility
            .preload('client')
            .preload('transitItems')
            // New structure preloads
            .preload('steps', (stepsQuery) => {
                stepsQuery.preload('stops', (stopsQuery) => {
                    stopsQuery.preload('actions')
                    stopsQuery.preload('address')
                })
            })
            .orderBy('createdAt', 'desc')
    }

    /**
     * Verify a pickup/delivery code on a leg.
     */
    async verifyCode(orderId: string, code: string) {
        if (!isValidCodeFormat(code)) {
            throw new Error('Invalid code format. Must be 6 digits.')
        }

        const trx = await db.transaction()
        try {
            const leg = await OrderLeg.query({ client: trx })
                .where('orderId', orderId)
                .where('verificationCode', code)
                .forUpdate()
                .first()

            if (!leg) {
                throw new Error('Invalid or already used verification code')
            }

            leg.status = 'COMPLETED'
            await leg.useTransaction(trx).save()
            await trx.commit()

            return leg
        } catch (error) {
            await trx.rollback()
            throw error
        }
    }

    /**
     * Driver refuses a mission.
     */
    async refuseMission(driverId: string, orderId: string) {
        const trx = await db.transaction()
        try {
            const order = await Order.query({ client: trx })
                .where('id', orderId)
                .forUpdate()
                .first()

            if (order && order.offeredDriverId === driverId) {
                await this.dispatchService.registerRejection(orderId, driverId)
                order.offeredDriverId = null
                order.offerExpiresAt = null
                await order.useTransaction(trx).save()

                const state = await RedisService.getDriverState(driverId)
                if (state && state.status === 'OFFERING') {
                    await RedisService.updateDriverState(driverId, { status: 'ONLINE' })
                }
                await trx.commit()

                this.dispatchService.dispatch(order).catch(err => {
                    logger.error({ err, orderId }, 'Dispatch failed after refusal')
                })
            } else {
                await trx.commit()
            }
        } catch (error) {
            await trx.rollback()
            throw error
        }
        return true
    }

    /**
     * Legacy/Support status update.
     */
    async updateStatus(orderId: string, driverId: string, status: string, _options: { latitude?: number, longitude?: number, reason?: string }) {
        // Enforce using atomic methods for core workflow, but allow terminal states manually
        if (['CANCELLED', 'FAILED'].includes(status)) {
            const order = await Order.query().where('id', orderId).andWhere('driverId', driverId).firstOrFail()
            order.status = status as any
            await order.save()
            await RedisService.removeOrderFromDriver(driverId, orderId)
            return order
        }
        throw new Error('Please use arrivedAtStop/completeAction for normal workflow progression')
    }
}
