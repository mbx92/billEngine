import { updateBillingSettingsSchema } from '../../../shared/schemas/settings'
import { SettingsService } from '../../services/settings/settings-service'
import { requestActor } from '../../utils/actor'

export default defineEventHandler(async (event) => {
  const session = await requireAdmin(event)
  const input = updateBillingSettingsSchema.parse(await readBody(event))
  const data = await new SettingsService().updateBillingSettings(
    input,
    requestActor(event, session.user.id),
  )

  return { data }
})
