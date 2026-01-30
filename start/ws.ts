import app from '@adonisjs/core/services/app'
import WsService from '#services/ws_service'
import server from '@adonisjs/core/services/server'

/**
 * Listen for the 'ready' event to attach Socket.io to the HTTP server.
 * This ensures the server is running before we try to attach.
 */
app.ready(async () => {
    // We need the underlying Node.js HTTP server
    const nodeServer = server.getNodeServer()
    if (nodeServer) {
        WsService.boot(nodeServer)
        console.log('✅ WebSocket Server initialized')
    } else {
        console.warn('⚠️ Could not initialize WebSocket: Server instance not found.')
    }
})
