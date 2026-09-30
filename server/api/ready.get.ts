import { useDatabase } from '../database/client'
import { checkDatabaseReadiness } from '../database/readiness'

export default defineEventHandler(async (event) => {
  const readiness = await checkDatabaseReadiness(useDatabase().$client)

  if (!readiness.ready) setResponseStatus(event, 503)

  return {
    status: readiness.ready ? 'ready' : 'not_ready',
    service: 'coolify-billing-platform',
    checks: readiness.checks,
    timestamp: new Date().toISOString(),
  }
})
