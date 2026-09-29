import { SettingsService } from '../../services/settings/settings-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { data: await new SettingsService().getBillingSettings() }
})
