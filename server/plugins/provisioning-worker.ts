import { ProvisioningService } from '../services/provisioning/provisioning-service'

const WORKER_INTERVAL_MS = 5_000
const STARTUP_DELAY_MS = 2_000

export default defineNitroPlugin((nitroApp) => {
  let running = false

  const execute = async () => {
    if (running) return
    running = true
    try {
      const result = await new ProvisioningService().processNext()
      if (result.acquired && result.result?.status === 'processed') {
        queueMicrotask(execute)
      }
    } catch (error) {
      console.error('[provisioning-worker]', error)
    } finally {
      running = false
    }
  }

  const startupTimer = setTimeout(execute, STARTUP_DELAY_MS)
  const intervalTimer = setInterval(execute, WORKER_INTERVAL_MS)
  startupTimer.unref()
  intervalTimer.unref()

  nitroApp.hooks.hook('close', () => {
    clearTimeout(startupTimer)
    clearInterval(intervalTimer)
  })
})
