import { Server } from 'socket.io'
import type { Server as HttpServer } from 'node:http'
import logger from '@adonisjs/core/services/logger'
import LocationSearchService from '#services/location_search_service'

class WsService {
    public io: Server | undefined
    private booted = false

    public boot(server: HttpServer) {
        if (this.booted) {
            return
        }

        this.booted = true
        this.io = new Server(server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
        })

        this.io.on('connection', (socket) => {
            logger.info({ socketId: socket.id }, 'Client connected to WebSocket')

            // Start worker if needed (idempotent)
            LocationSearchService.startWorker()

            socket.on('search_place', (data) => {
                LocationSearchService.addToQueue(socket.id, data)
            })

            socket.on('join', (room: string) => {
                logger.info({ socketId: socket.id, room }, 'Client joining room')
                socket.join(room)
            })

            socket.on('disconnect', (reason) => {
                logger.info({ socketId: socket.id, reason }, 'Client disconnected from WebSocket')
            })
        })

        logger.info('WebSocket service booted successfully')
    }

    /**
     * Send an event to a specific room.
     */
    public emitToRoom(room: string, event: string, data: any) {
        if (this.io) {
            if (event === 'search_result') {
                logger.info({ room, resultCount: data.results?.length }, 'Emitting search results to room')
            }
            this.io.to(room).emit(event, data)
        }
    }

    /**
     * Send an event to all connected clients.
     */
    public emitToAll(event: string, data: any) {
        if (this.io) {
            this.io.emit(event, data)
        }
    }

    /**
     * Notify all parties (Driver & Manager/Dashboard) that an order route has been updated.
     */
    public notifyOrderRouteUpdate(orderId: string, driverId?: string | null, clientId?: string | null) {
        const payload = {
            orderId,
            message: 'Route updated. Refresh map.',
            timestamp: new Date().toISOString()
        }

        // 1. Notify the order-specific room (Managers join this room: "order:{id}")
        this.emitToRoom(`order:${orderId}`, 'route_updated', payload)

        // 2. Notify the global fleet room for this client (Dashboard joins this)
        if (clientId) {
            this.emitToRoom(`fleet:${clientId}`, 'route_updated', payload)
        }

        // 3. Notify the global logistics room (Generic fallback)
        this.emitToRoom('logistics', 'route_updated', payload)

        // 4. Notify the driver-specific room
        if (driverId) {
            this.emitToRoom(`driver:${driverId}`, 'route_updated', payload)
        }
    }

    /**
     * Notify that the order structure (steps, stops, actions, items) has changed.
     */
    public notifyOrderUpdate(orderId: string, clientId?: string | null) {
        const payload = {
            orderId,
            message: 'Order structure updated.',
            timestamp: new Date().toISOString()
        }

        this.emitToRoom(`order:${orderId}`, 'order_updated', payload)
        if (clientId) {
            this.emitToRoom(`fleet:${clientId}`, 'order_updated', payload)
        }
    }
}

export default new WsService()
