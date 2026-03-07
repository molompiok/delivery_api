import app from '@adonisjs/core/services/app'
import waveTransmitBridgeService from '#services/wave_transmit_bridge_service'

app.ready(async () => {
  try {
    await waveTransmitBridgeService.start()
  } catch (error) {
    console.error('[WaveTransmitBridge] Failed to start bridge', error)
  }
})

app.terminating(async () => {
  await waveTransmitBridgeService.stop()
})
