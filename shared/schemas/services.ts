import { z } from 'zod'

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(max).optional(),
  )

const optionalTaxRate = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'Tax rate harus berupa angka desimal.')
    .refine((value) => Number(value) >= 0 && Number(value) <= 1, {
      message: 'Tax rate harus berada di antara 0 dan 1.',
    })
    .optional(),
)

export const createServiceSchema = z
  .object({
    customerId: z.uuid(),
    planId: z.uuid(),
    name: z.string().trim().min(2).max(200),
    description: optionalText(5_000),
    billingStartDate: z.iso.date(),
    nextDueDate: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.iso.date().optional(),
    ),
    invoiceLeadDays: z.coerce.number().int().min(0).max(365).default(0),
    paymentDueDays: z.coerce.number().int().min(0).max(365).default(7),
    taxRate: optionalTaxRate,
    resourceIds: z
      .array(z.uuid())
      .max(100)
      .default([])
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Resource yang sama tidak boleh dipilih lebih dari sekali.',
      }),
  })
  .superRefine((input, context) => {
    if (input.nextDueDate && input.nextDueDate < input.billingStartDate) {
      context.addIssue({
        code: 'custom',
        path: ['nextDueDate'],
        message: 'Jatuh tempo berikutnya tidak boleh sebelum tanggal mulai billing.',
      })
    }
  })

export type CreateServiceInput = z.infer<typeof createServiceSchema>
