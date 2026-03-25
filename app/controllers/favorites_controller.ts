import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { inject } from '@adonisjs/core'
import FavoritesService from '#services/favorites_service'

@inject()
export default class FavoritesController {
  constructor(protected favoritesService: FavoritesService) {}

  private normalizeStringFilter(value: unknown) {
    if (typeof value !== 'string') return undefined

    const normalizedValue = value.trim()
    return normalizedValue.length > 0 ? normalizedValue : undefined
  }

  static updateValidator = vine.compile(
    vine.object({
      isPinned: vine.boolean().optional(),
    })
  )

  async index({ auth, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const kind = request.input('kind')
      const context = request.input('context')
      const ownerType = request.input('ownerType')
      const ownerId = request.input('ownerId')
      const limitRaw = Number(request.input('limit', 8))

      const favorites = await this.favoritesService.listFavorites(user, {
        kind: this.normalizeStringFilter(kind),
        context: this.normalizeStringFilter(context),
        ownerType:
          ownerType === 'User' || ownerType === 'Company'
            ? ownerType
            : undefined,
        ownerId: this.normalizeStringFilter(ownerId),
        limit: Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, limitRaw)) : 8,
      })

      return response.ok(favorites.map((favorite) => favorite.serialize()))
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async update({ auth, params, request, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      const payload = await request.validateUsing(FavoritesController.updateValidator)
      const favorite = await this.favoritesService.updateFavorite(user, params.id, payload)
      return response.ok(favorite)
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }

  async destroy({ auth, params, response }: HttpContext) {
    try {
      const user = auth.getUserOrFail()
      await this.favoritesService.deleteFavorite(user, params.id)
      return response.noContent()
    } catch (error: any) {
      return response.badRequest({ message: error.message })
    }
  }
}
