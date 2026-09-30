import { PortalService } from '../../services/portal/portal-service'

export default defineEventHandler(async (event) => {
  const session = await requireCustomer(event)
  return { data: await new PortalService().summary(session.customerId) }
})
