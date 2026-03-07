import transmit from '@adonisjs/transmit/services/main'

transmit.registerRoutes((route) => {
  route.prefix('/v1')
})

