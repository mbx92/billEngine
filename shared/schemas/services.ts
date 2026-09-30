import { z } from 'zod'
import { SERVICE_STATUSES } from '../constants/domain'

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

const nullableOptionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable().optional(),
  )

const nullableOptionalTaxRate = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'Tax rate harus berupa angka desimal.')
    .refine((value) => Number(value) >= 0 && Number(value) <= 1, {
      message: 'Tax rate harus berada di antara 0 dan 1.',
    })
    .nullable()
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

export const updateServiceSchema = z
  .object({
    planId: z.uuid().optional(),
    name: z.string().trim().min(2).max(200).optional(),
    description: nullableOptionalText(5_000),
    nextDueDate: z.iso.date().nullable().optional(),
    invoiceLeadDays: z.coerce.number().int().min(0).max(365).optional(),
    paymentDueDays: z.coerce.number().int().min(0).max(365).optional(),
    taxRate: nullableOptionalTaxRate,
    resourceIds: z
      .array(z.uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Resource yang sama tidak boleh dipilih lebih dari sekali.',
      })
      .optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Tidak ada perubahan service.')

export const transitionServiceSchema = z.object({
  status: z.enum(SERVICE_STATUSES),
  reason: z.string().trim().min(3).max(1_000),
})

export const applyInfrastructureSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  restartRunning: z.boolean().default(true),
})

export type UpdateServiceInput = z.infer<typeof updateServiceSchema>
export type TransitionServiceInput = z.infer<typeof transitionServiceSchema>
export type ApplyInfrastructureInput = z.infer<typeof applyInfrastructureSchema>
