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
     * Notify a driver that their route has been updated.
     */
    public notifyDriverRouteUpdate(driverId: string, orderId: string) {
        this.emitToRoom(`driver:${driverId}`, 'route_updated', {
            orderId,
            message: 'Your route has been updated. Please refresh your view.',
            timestamp: new Date().toISOString()
        })
    }
}

export default new WsService()
