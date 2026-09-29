import { z } from 'zod'
import { CUSTOMER_STATUSES } from '../constants/domain'

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  )

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  companyName: optionalText(200),
  email: z.email().max(320),
  phone: optionalText(40),
  addressLine1: optionalText(255),
  addressLine2: optionalText(255),
  city: optionalText(120),
  province: optionalText(120),
  postalCode: optionalText(20),
  countryCode: z.string().trim().length(2).toUpperCase().default('ID'),
  taxId: optionalText(80),
  notes: optionalText(5_000),
})

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  status: z.enum(CUSTOMER_STATUSES).optional(),
})

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>
