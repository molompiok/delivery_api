import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Favorite, {
  FavoriteOwnerType,
  FavoriteSource,
} from '#models/favorite'
import User from '#models/user'
import Address from '#models/address'
import Order from '#models/order'

@inject()
export default class FavoritesService {
  private normalizeText(value: string | null | undefined) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  }

  private roundCoordinate(value: number | null | undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return value.toFixed(5)
  }

  private async assertOwnerAccess(
    user: User,
    ownerType: FavoriteOwnerType,
    ownerId: string
  ) {
    if (user.isAdmin) return

    if (ownerType === 'User' && ownerId === user.id) return

    if (ownerType === 'Company') {
      const activeCompanyId = user.currentCompanyManaged || user.companyId
      if (activeCompanyId === ownerId) return
    }

    throw new Error('Unauthorized to manage favorites for this owner')
  }

  private buildAddressSnapshot(address: Partial<Address> & Record<string, any>) {
    const street = String(address.street || address.formattedAddress || '').trim()
    const city = String(address.city || '').trim()
    const country = String(address.country || '').trim()

    return {
      label: address.label || street,
      formattedAddress:
        String(address.formattedAddress || '').trim() ||
        [street, city, country].filter(Boolean).join(', '),
      street,
      city,
      country,
      lat: address.lat,
      lng: address.lng,
      call: address.call || null,
      room: address.room || null,
      stage: address.stage || null,
    }
  }

  async listFavorites(
    user: User,
    options: {
      ownerType?: FavoriteOwnerType
      ownerId?: string
      kind?: string
      context?: string
      limit?: number
    } = {}
  ) {
    const ownerType = options.ownerType || 'User'
    const ownerId = options.ownerId || user.id
    await this.assertOwnerAccess(user, ownerType, ownerId)

    const query = Favorite.query()
      .where('ownerType', ownerType)
      .where('ownerId', ownerId)
      .orderBy('isPinned', 'desc')
      .orderBy('lastUsedAt', 'desc')
      .orderBy('usageCount', 'desc')

    if (options.kind) {
      query.where('kind', options.kind)
    }

    if (options.context) {
      query.where('context', options.context)
    }

    if (options.limit) {
      query.limit(options.limit)
    }

    return query
  }

  async updateFavorite(
    user: User,
    favoriteId: string,
    payload: { isPinned?: boolean }
  ) {
    const favorite = await Favorite.findOrFail(favoriteId)
    await this.assertOwnerAccess(user, favorite.ownerType, favorite.ownerId)

    if (payload.isPinned !== undefined) {
      favorite.isPinned = payload.isPinned
    }

    await favorite.save()
    return favorite
  }

  async deleteFavorite(user: User, favoriteId: string) {
    const favorite = await Favorite.findOrFail(favoriteId)
    await this.assertOwnerAccess(user, favorite.ownerType, favorite.ownerId)
    await favorite.delete()
  }

  async recordUsage(
    payload: {
      ownerType: FavoriteOwnerType
      ownerId: string
      tableName: string
      tableId: string
      context?: string | null
      kind: string
      source?: FavoriteSource
      snapshot?: Record<string, any>
      metadata?: Record<string, any>
    },
    trx?: TransactionClientContract
  ) {
    const favorite = await Favorite.query({ client: trx })
      .where('ownerType', payload.ownerType)
      .where('ownerId', payload.ownerId)
      .where('tableName', payload.tableName)
      .where('tableId', payload.tableId)
      .where('context', payload.context || '')
      .first()

    if (favorite) {
      favorite.usageCount = (favorite.usageCount || 0) + 1
      favorite.lastUsedAt = DateTime.now()
      favorite.snapshot = payload.snapshot || favorite.snapshot || {}
      favorite.metadata = {
        ...(favorite.metadata || {}),
        ...(payload.metadata || {}),
      }

      if (favorite.source !== 'manual') {
        favorite.source = payload.source || favorite.source || 'implicit'
      }

      if (trx) favorite.useTransaction(trx)
      await favorite.save()
      return favorite
    }

    return Favorite.create(
      {
        ownerType: payload.ownerType,
        ownerId: payload.ownerId,
        tableName: payload.tableName,
        tableId: payload.tableId,
        context: payload.context || '',
        kind: payload.kind,
        source: payload.source || 'implicit',
        isPinned: false,
        usageCount: 1,
        lastUsedAt: DateTime.now(),
        snapshot: payload.snapshot || {},
        metadata: payload.metadata || {},
      },
      { client: trx }
    )
  }

  async upsertSavedAddress(
    payload: {
      ownerType: 'User' | 'Company'
      ownerId: string
      label?: string | null
      formattedAddress?: string | null
      street?: string | null
      city?: string | null
      country?: string | null
      lat?: number | null
      lng?: number | null
      call?: string | null
      room?: string | null
      stage?: string | null
    },
    trx?: TransactionClientContract
  ) {
    const roundedLat = this.roundCoordinate(payload.lat)
    const roundedLng = this.roundCoordinate(payload.lng)

    let query = Address.query({ client: trx })
      .where('ownerType', payload.ownerType)
      .where('ownerId', payload.ownerId)
      .where('isActive', true)

    if (payload.lat !== undefined && payload.lat !== null) {
      query = query.whereBetween('lat', [payload.lat - 0.00002, payload.lat + 0.00002])
    }

    if (payload.lng !== undefined && payload.lng !== null) {
      query = query.whereBetween('lng', [payload.lng - 0.00002, payload.lng + 0.00002])
    }

    const candidates = await query.limit(10)

    const existing = candidates.find((candidate) => {
      return (
        this.roundCoordinate(candidate.lat) === roundedLat &&
        this.roundCoordinate(candidate.lng) === roundedLng &&
        this.normalizeText(candidate.street) === this.normalizeText(payload.street) &&
        this.normalizeText(candidate.city) === this.normalizeText(payload.city) &&
        this.normalizeText(candidate.country) === this.normalizeText(payload.country)
      )
    })

    if (existing) {
      existing.label = payload.label || existing.label
      existing.formattedAddress =
        payload.formattedAddress || existing.formattedAddress || payload.street || existing.street || 'Adresse'
      existing.street = payload.street || existing.street
      existing.city = payload.city || existing.city
      existing.country = payload.country || existing.country
      existing.call = payload.call ?? existing.call
      existing.room = payload.room ?? existing.room
      existing.stage = payload.stage ?? existing.stage
      if (trx) existing.useTransaction(trx)
      await existing.save()
      return existing
    }

    return Address.create(
      {
        ownerType: payload.ownerType,
        ownerId: payload.ownerId,
        label: payload.label || payload.street || 'Adresse',
        formattedAddress:
          payload.formattedAddress ||
          [payload.street, payload.city, payload.country]
            .filter((part) => String(part || '').trim().length > 0)
            .join(', ') ||
          'Adresse',
        street: payload.street || null,
        city: payload.city || null,
        country: payload.country || null,
        lat: payload.lat ?? 0,
        lng: payload.lng ?? 0,
        call: payload.call || null,
        room: payload.room || null,
        stage: payload.stage || null,
        isActive: true,
        isDefault: false,
      },
      { client: trx }
    )
  }

  async syncImplicitFromOrder(
    orderId: string,
    owner: { ownerType: FavoriteOwnerType; ownerId: string },
    trx?: TransactionClientContract
  ) {
    const order = await Order.query({ client: trx })
      .where('id', orderId)
      .preload('company')
      .preload('steps', (query) => {
        query.preload('stops', (stopQuery) => {
          stopQuery.preload('address')
        })
      })
      .first()

    if (!order) return

    if (order.companyId) {
      await this.recordUsage(
        {
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          tableName: 'Company',
          tableId: order.companyId,
          context: 'order_create',
          kind: 'company',
          source: 'implicit',
          snapshot: {
            name: order.company?.name || '',
            activityType: order.company?.activityType || '',
            logo: null,
          },
          metadata: {
            lastOrderId: order.id,
            assignmentMode: order.assignmentMode,
          },
        },
        trx
      )
    }

    for (const step of order.steps || []) {
      for (const stop of step.stops || []) {
        const address = stop.address
        if (!address) continue
        if (!Number.isFinite(address.lat) || !Number.isFinite(address.lng)) continue
        if (!String(address.street || '').trim()) continue

        const savedAddress = await this.upsertSavedAddress(
          {
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
            label: address.label || address.street,
            formattedAddress: address.formattedAddress,
            street: address.street,
            city: address.city,
            country: address.country,
            lat: address.lat,
            lng: address.lng,
            call: address.call,
            room: address.room,
            stage: address.stage,
          },
          trx
        )

        await this.recordUsage(
          {
            ownerType: owner.ownerType,
            ownerId: owner.ownerId,
            tableName: 'Address',
            tableId: savedAddress.id,
            kind: 'address',
            source: 'implicit',
            snapshot: this.buildAddressSnapshot(savedAddress),
            metadata: {
              lastOrderId: order.id,
              lastStopId: stop.id,
            },
          },
          trx
        )
      }
    }
  }
}
