import { z } from 'zod'
import { BILLING_CYCLES } from '../constants/domain'

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  )

const optionalPositiveInteger = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.number().int().positive().max(1_000).optional(),
)

const optionalPositiveDecimal = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, 'CPU harus berupa angka dengan maksimal 3 desimal.')
    .refine((value) => Number(value) > 0, 'CPU harus lebih besar dari nol.')
    .optional(),
)

const optionalPositiveBigInt = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.bigint().positive().optional(),
)

const planPrice = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.bigint().nonnegative('Harga plan tidak boleh negatif.'),
)

const nullablePositiveInteger = z.preprocess(
  (value) => (value === '' ? null : value),
  z.coerce.number().int().positive().max(1_000).nullable().optional(),
)

const nullablePositiveDecimal = z.preprocess(
  (value) => (value === '' ? null : value),
  z.coerce
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, 'CPU harus berupa angka dengan maksimal 3 desimal.')
    .refine((value) => Number(value) > 0, 'CPU harus lebih besar dari nol.')
    .nullable()
    .optional(),
)

const nullablePositiveBigInt = z.preprocess(
  (value) => (value === '' ? null : value),
  z.coerce.bigint().positive().nullable().optional(),
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
  priceAmount: planPrice,
  billingCycle: z.enum(BILLING_CYCLES),
  inclusions: planInclusionsSchema,
  includedResourceCount: optionalPositiveInteger,
  includedCpuCores: optionalPositiveDecimal,
  includedMemoryBytes: optionalPositiveBigInt,
})

export const updatePlanSchema = createPlanSchema
  .partial()
  .extend({
    isActive: z.boolean().optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    includedResourceCount: nullablePositiveInteger,
    includedCpuCores: nullablePositiveDecimal,
    includedMemoryBytes: nullablePositiveBigInt,
  })
  .refine((input) => Object.keys(input).length > 0, 'Tidak ada perubahan plan.')

export type CreatePlanInput = z.infer<typeof createPlanSchema>
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>
