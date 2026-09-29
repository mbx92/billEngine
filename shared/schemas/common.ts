import { z } from 'zod'

export const uuidSchema = z.uuid()

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
})

export const idrAmountSchema = z.coerce.bigint().nonnegative()
