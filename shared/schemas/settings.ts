import { z } from 'zod'

function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable(),
  )

export const updateBillingSettingsSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  companyEmail: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.email().max(320).nullable(),
  ),
  companyAddress: nullableText(5_000),
  companyTaxId: nullableText(80),
  billingTimezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(isTimeZone, 'Timezone IANA tidak valid.'),
  billingCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{3}$/.test(value), 'Kode mata uang tidak valid.'),
  defaultTaxRate: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z
      .string()
      .trim()
      .regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/, 'Tax rate harus antara 0 dan 1.')
      .nullable(),
  ),
  billingAutomationEnabled: z.boolean().default(false),
  billingAccessControlEnabled: z.boolean().default(false),
  overdueGraceDays: z.coerce.number().int().min(0).max(90).default(7),
  graceNoticeIntervalHours: z.coerce.number().int().min(1).max(168).default(24),
})

export type UpdateBillingSettingsInput = z.infer<typeof updateBillingSettingsSchema>
