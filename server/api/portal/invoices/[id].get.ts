import { uuidSchema } from '../../../../shared/schemas/common'
import { PortalService } from '../../../services/portal/portal-service'

export default defineEventHandler(async (event) => {
  const session = await requireCustomer(event)
  const id = uuidSchema.parse(getRouterParam(event, 'id'))
  const result = await new PortalService().invoiceDetail(session.customerId, id)
  return { data: result.serialized }
})
