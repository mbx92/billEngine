import { createCustomerSchema } from '../../../shared/schemas/customers'
import { CustomerService } from '../../services/customers/customer-service'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const input = createCustomerSchema.parse(await readBody(event))
  const customer = await new CustomerService().create(input)
  setResponseStatus(event, 201)
  return { data: customer }
})
