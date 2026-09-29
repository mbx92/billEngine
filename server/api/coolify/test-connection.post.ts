import { useCoolifyClient } from '../../integrations/coolify/client'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const connected = await useCoolifyClient().testConnection()
  return { data: { connected } }
})
