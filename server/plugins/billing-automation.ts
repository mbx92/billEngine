import { BillingAutomationService } from '../services/billing/automation-service'

const AUTOMATION_INTERVAL_MS = 60 * 60 * 1_000
const STARTUP_DELAY_MS = 15_000

export default defineNitroPlugin((nitroApp) => {
  let running = false

  const execute = async () => {
    if (running) return
    running = true
    try {
      await new BillingAutomationService().run()
    } catch (error) {
      console.error('[billing-automation]', error)
    } finally {
      running = false
    }
  }

  const startupTimer = setTimeout(execute, STARTUP_DELAY_MS)
  const intervalTimer = setInterval(execute, AUTOMATION_INTERVAL_MS)
  startupTimer.unref()
  intervalTimer.unref()

  nitroApp.hooks.hook('close', () => {
    clearTimeout(startupTimer)
    clearInterval(intervalTimer)
  })
})
