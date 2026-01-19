import { Server } from 'socket.io'
import type { Server as HttpServer } from 'node:http'
import logger from '@adonisjs/core/services/logger'

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
}

export default new WsService()
