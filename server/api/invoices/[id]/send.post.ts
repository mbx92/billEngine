import { uuidSchema } from '../../../../shared/schemas/common'
import { EmailNotificationService } from '../../../services/notifications/email-notification-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const invoiceId = uuidSchema.parse(getRouterParam(event, 'id'))
  return { data: await new EmailNotificationService().sendInvoice(invoiceId, 'invoice_issued') }
})
