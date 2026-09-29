import { z } from 'zod'
import { BILLING_CYCLES } from '../constants/domain'

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  )

const planInclusionsSchema = z
  .array(z.string().trim().min(1, 'Isi benefit tidak boleh kosong.').max(160))
  .min(1, 'Tambahkan minimal satu benefit plan.')
  .max(30)
  .refine(
    (items) => new Set(items.map((item) => item.toLocaleLowerCase())).size === items.length,
    'Benefit plan tidak boleh duplikat.',
  )

export const createPlanSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: optionalText(5_000),
  currency: z.string().trim().length(3).toUpperCase().default('IDR'),
  priceAmount: z.coerce.bigint().positive('Harga plan harus lebih besar dari nol.'),
  billingCycle: z.enum(BILLING_CYCLES),
  inclusions: planInclusionsSchema,
})

export const updatePlanSchema = createPlanSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((input) => Object.keys(input).length > 0, 'Tidak ada perubahan plan.')

export type CreatePlanInput = z.infer<typeof createPlanSchema>
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>
