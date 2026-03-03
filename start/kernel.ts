/*
|--------------------------------------------------------------------------
| HTTP kernel file
|--------------------------------------------------------------------------
|
| The HTTP kernel file is used to register the middleware with the server
| or the router.
|
*/

import router from '@adonisjs/core/services/router'
import server from '@adonisjs/core/services/server'

console.trace('start/kernel imported')

/**
 * The error handler is used to convert an exception
 * to an HTTP response.
 */
try {
  server.errorHandler(() => import('#exceptions/handler'))

  /**
   * The server middleware stack runs middleware on all the HTTP
   * requests, even if there is no route registered for
   * the request URL.
   */
  server.use([
    () => import('#middleware/container_bindings_middleware'),
    () => import('#middleware/force_json_response_middleware'),
    () => import('@adonisjs/cors/cors_middleware'),
  ])
} catch (e) {
  // Ignore in CLI environments where server proxy binding is unavailable
}

/**
 * The router middleware stack runs middleware on all the HTTP
 * requests with a registered route.
 */
router.use([() => import('@adonisjs/core/bodyparser_middleware'), () => import('@adonisjs/auth/initialize_auth_middleware')])

/**
 * Named middleware collection must be explicitly assigned to
 * the routes or the routes group.
 */
export const middleware = router.named({
  auth: () => import('#middleware/auth_middleware'),
  api: () => import('#middleware/api_middleware')
})
