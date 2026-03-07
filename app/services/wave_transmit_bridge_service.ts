import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import transmit from '@adonisjs/transmit/services/main'
import { Transmit, type Subscription } from '@adonisjs/transmit-client'
import { EventSource } from 'eventsource'

type WaveEventPayload = {
  type: string
  referenceId?: string
  scopes?: string[]
  payload?: Record<string, any>
  timestamp?: string
}

type ActiveSubscription = {
  subscription: Subscription
  removeHandler: () => void
}

class WaveTransmitBridgeService {
  private started = false
  private client: Transmit | null = null
  private subscriptions: ActiveSubscription[] = []

  private normalizeChannel(value: string) {
    return value.replace(/:/g, '/').trim()
  }

  private parseChannels() {
    const explicitChannels = env.get('WAVE_TRANSMIT_CHANNELS')
    if (explicitChannels) {
      return explicitChannels
        .split(',')
        .map((item) => this.normalizeChannel(item))
        .filter((item) => item.length > 0)
    }

    const managerId = env.get('WAVE_MANAGER_ID')
    if (managerId) {
      return [this.normalizeChannel(`manager:${managerId}`)]
    }

    return ['admin']
  }

  private applyAuthHeaders(request: Request | RequestInit) {
    const apiKey = env.get('WAVE_API_KEY')
    const managerId = env.get('WAVE_MANAGER_ID')
    if (!apiKey || !managerId) {
      return
    }

    if (request instanceof Request) {
      request.headers.set('Authorization', `Bearer ${apiKey}`)
      request.headers.set('X-Manager-Id', managerId)
      return
    }

    const headers = new Headers(request.headers || {})
    headers.set('Authorization', `Bearer ${apiKey}`)
    headers.set('X-Manager-Id', managerId)
    request.headers = headers
  }

  private getBaseUrl() {
    const base = (env.get('WAVE_TRANSMIT_BASE_URL') || env.get('WAVE_API_URL') || 'http://localhost:3335').replace(/\/+$/, '')
    return base.endsWith('/v1') ? base : `${base}/v1`
  }

  private rebroadcast(event: WaveEventPayload) {
    const incomingScopes = (event.scopes || []).map((scope) => this.normalizeChannel(scope))
    const channels = new Set<string>(['wave/all'])

    for (const scope of incomingScopes) {
      channels.add(`wave/${scope}`)
    }

    if (event.type) {
      channels.add(`wave/type/${event.type.replace(/\./g, '/')}`)
    }

    if (event.referenceId) {
      channels.add(`wave/ref/${event.referenceId}`)
    }

    for (const channel of channels) {
      transmit.broadcast(channel, event)
    }
  }

  public async start() {
    if (this.started) {
      return
    }

    const enabled = env.get('WAVE_TRANSMIT_ENABLED', false)
    if (!enabled) {
      logger.info('[WaveTransmitBridge] Disabled (WAVE_TRANSMIT_ENABLED=false)')
      return
    }

    const channels = this.parseChannels()
    if (channels.length === 0) {
      logger.warn('[WaveTransmitBridge] No channels configured to subscribe')
      return
    }

    if (typeof (globalThis as any).EventSource === 'undefined') {
      ;(globalThis as any).EventSource = EventSource
    }

    this.client = new Transmit({
      baseUrl: this.getBaseUrl(),
      beforeSubscribe: (request) => this.applyAuthHeaders(request as RequestInit),
      beforeUnsubscribe: (request) => this.applyAuthHeaders(request as RequestInit),
      onSubscribeFailed: async (response) => {
        const body = await response.text().catch(() => '')
        logger.error(
          { status: response.status, body },
          '[WaveTransmitBridge] Subscribe failed against wave-api transmit'
        )
      },
      onReconnectAttempt: (attempt) => {
        logger.warn({ attempt }, '[WaveTransmitBridge] Reconnect attempt')
      },
      onReconnectFailed: () => {
        logger.error('[WaveTransmitBridge] Reconnect failed')
      },
    })

    this.client.on('connected', () => logger.info('[WaveTransmitBridge] Connected to wave-api transmit'))
    this.client.on('disconnected', () => logger.warn('[WaveTransmitBridge] Disconnected from wave-api transmit'))
    this.client.on('reconnecting', () => logger.warn('[WaveTransmitBridge] Reconnecting to wave-api transmit'))

    for (const channel of channels) {
      try {
        const subscription = this.client.subscription(channel)
        const removeHandler = subscription.onMessage((message) => {
          this.rebroadcast(message as WaveEventPayload)
        })

        await subscription.create()
        this.subscriptions.push({ subscription, removeHandler })
        logger.info({ channel }, '[WaveTransmitBridge] Subscribed to wave channel')
      } catch (error) {
        logger.error({ channel, error }, '[WaveTransmitBridge] Failed to subscribe to wave channel')
      }
    }

    if (this.subscriptions.length === 0) {
      logger.error('[WaveTransmitBridge] No active subscriptions, bridge not started')
      this.client.close()
      this.client = null
      return
    }

    this.started = true
    logger.info({ channels }, '[WaveTransmitBridge] Started')
  }

  public async stop() {
    if (!this.started) {
      return
    }

    for (const entry of this.subscriptions) {
      entry.removeHandler()
      if (entry.subscription.handlerCount === 0) {
        await entry.subscription.delete().catch(() => undefined)
      }
    }

    this.subscriptions = []
    this.client?.close()
    this.client = null
    this.started = false
    logger.info('[WaveTransmitBridge] Stopped')
  }
}

export default new WaveTransmitBridgeService()
