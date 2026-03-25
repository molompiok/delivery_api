import User from '#models/user'

export type OrderAccessScope = 'self' | 'company' | 'driver' | 'admin'

export interface OrderAccessContext {
  scope: OrderAccessScope
  userId: string
  companyId?: string
  driverId?: string
}

export function getRequestedOrderAccessScope(request: any): string | undefined {
  const headerScope = request?.header?.('x-order-access-context')
  if (typeof headerScope === 'string' && headerScope.trim().length > 0) {
    return headerScope
  }

  const inputScope = request?.input?.('access_context')
  if (typeof inputScope === 'string' && inputScope.trim().length > 0) {
    return inputScope
  }

  return undefined
}

export function resolveOrderAccessContext(
  user: User,
  requestedScope?: string | null
): OrderAccessContext {
  const normalizedScope = String(requestedScope || 'self').trim().toLowerCase()

  switch (normalizedScope) {
    case 'self':
    case '':
      return { scope: 'self', userId: user.id }

    case 'company':
      if (!user.currentCompanyManaged) {
        throw new Error('FORBIDDEN: Company order access requires an active managed company context')
      }
      return {
        scope: 'company',
        userId: user.id,
        companyId: user.currentCompanyManaged,
      }

    case 'driver':
      if (!user.isDriver) {
        throw new Error('FORBIDDEN: Driver order access requires a driver account')
      }
      return {
        scope: 'driver',
        userId: user.id,
        driverId: user.id,
      }

    case 'admin':
      if (!user.isAdmin) {
        throw new Error('FORBIDDEN: Admin order access requires admin privileges')
      }
      return {
        scope: 'admin',
        userId: user.id,
      }

    default:
      throw new Error(`FORBIDDEN: Unsupported order access context "${requestedScope}"`)
  }
}

export function assertAllowedOrderAccessScope(
  access: OrderAccessContext,
  allowedScopes: OrderAccessScope[]
) {
  if (!allowedScopes.includes(access.scope)) {
    throw new Error(`FORBIDDEN: Order access context "${access.scope}" is not allowed here`)
  }
}

export function getWriteTargetCompanyId(access: OrderAccessContext): string | undefined {
  return access.scope === 'company' ? access.companyId : undefined
}

export function toOrderAccessContext(
  requester: string | OrderAccessContext,
  options: {
    targetCompanyId?: string
    targetDriverId?: string
  } = {}
): OrderAccessContext {
  if (typeof requester !== 'string') {
    return requester
  }

  if (options.targetDriverId) {
    return {
      scope: 'driver',
      userId: requester,
      driverId: options.targetDriverId,
    }
  }

  if (options.targetCompanyId) {
    return {
      scope: 'company',
      userId: requester,
      companyId: options.targetCompanyId,
    }
  }

  return {
    scope: 'self',
    userId: requester,
  }
}

export function applyOrderReadScope(query: any, access: OrderAccessContext) {
  switch (access.scope) {
    case 'self':
      query.where('clientId', access.userId)
      break

    case 'company':
      query.where('companyId', access.companyId!)
      break

    case 'driver':
      query.where((driverQuery: any) => {
        driverQuery.where('driverId', access.driverId!).orWhere('offeredDriverId', access.driverId!)
      })
      break

    case 'admin':
      break
  }

  return query
}
