import { useDatabase } from '../database/client'
import { checkDatabaseReadiness } from '../database/readiness'
import { SettingsService } from '../services/settings/settings-service'

export default defineEventHandler(async (event) => {
  const readiness = await checkDatabaseReadiness(useDatabase().$client)
  const settings = readiness.ready
    ? await new SettingsService().getBillingSettings().catch(() => null)
    : null

  if (!readiness.ready) setResponseStatus(event, 503)

  return {
    status: readiness.ready ? 'ready' : 'not_ready',
    service: 'coolify-billing-platform',
    checks: readiness.checks,
    features: {
      billingAutomation: settings?.billingAutomationEnabled ?? null,
      billingAccessControl: settings?.billingAccessControlEnabled ?? null,
    },
    timestamp: new Date().toISOString(),
  }
})
