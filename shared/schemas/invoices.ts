import { z } from 'zod'
import { INVOICE_STATUSES, PAYMENT_STATUSES } from '../constants/domain'
import { idrAmountSchema, paginationSchema, uuidSchema } from './common'

export const invoiceListQuerySchema = paginationSchema.extend({
  status: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(INVOICE_STATUSES).optional(),
  ),
  customerId: z.preprocess((value) => (value === '' ? undefined : value), uuidSchema.optional()),
  query: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).max(120).optional(),
  ),
})

const isoDateSchema = z.iso.date()

/**
 * Manual invoice creation. The admin chooses the customer, the due date, and
 * the line items; totals are always recomputed server-side from the lines so a
 * client can never dictate the amount owed.
 */
export const createInvoiceSchema = z
  .object({
    customerId: uuidSchema,
    issueDate: isoDateSchema,
    dueDate: isoDateSchema,
    notes: z.string().trim().max(5_000).optional(),
    items: z
      .array(
        z.object({
          serviceId: uuidSchema.optional(),
          description: z.string().trim().min(2).max(500),
          /** numeric(14,4) as a string, e.g. "1" or "1.5". */
          quantity: z
            .string()
            .trim()
            .regex(/^\d+(\.\d{1,4})?$/, 'Quantity tidak valid.')
            .default('1'),
          unitPriceAmount: idrAmountSchema,
          /** numeric(7,4) fraction, e.g. "0.11" for 11%. */
          taxRate: z
            .string()
            .trim()
            .regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/, 'Tax rate harus antara 0 dan 1.')
            .optional(),
          servicePeriodStart: isoDateSchema.optional(),
          servicePeriodEnd: isoDateSchema.optional(),
        }),
      )
      .min(1, 'Invoice harus memiliki minimal satu item.'),
  })
  .superRefine((input, context) => {
    if (input.dueDate < input.issueDate) {
      context.addIssue({
        code: 'custom',
        path: ['dueDate'],
        message: 'Due date tidak boleh sebelum issue date.',
      })
    }

    input.items.forEach((item, index) => {
      if (
        item.servicePeriodStart &&
        item.servicePeriodEnd &&
        item.servicePeriodEnd < item.servicePeriodStart
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'servicePeriodEnd'],
          message: 'Akhir periode tidak boleh sebelum awal periode.',
        })
      }
    })
  })

export const generateRecurringInvoicesSchema = z.object({
  /** Defaults to the billing timezone's current date on the server. */
  asOf: isoDateSchema.optional(),
  /** Safety valve: refuse to invoice more than this many services per run. */
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export const recordPaymentSchema = z.object({
  invoiceId: uuidSchema,
  amount: idrAmountSchema.refine((value) => value > 0n, 'Jumlah pembayaran harus lebih dari 0.'),
  method: z.string().trim().min(2).max(80),
  reference: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(5_000).optional(),
  paidAt: z.iso.datetime({ offset: true }).optional(),
  /** Recorded explicitly so a bounced transfer can be excluded from balances. */
  status: z.enum(PAYMENT_STATUSES).default('completed'),
})

export const paymentListQuerySchema = paginationSchema.extend({
  invoiceId: z.preprocess((value) => (value === '' ? undefined : value), uuidSchema.optional()),
  status: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(PAYMENT_STATUSES).optional(),
  ),
  from: z.preprocess((value) => (value === '' ? undefined : value), isoDateSchema.optional()),
  to: z.preprocess((value) => (value === '' ? undefined : value), isoDateSchema.optional()),
})

export const markOverdueSchema = z.object({
  asOf: isoDateSchema.optional(),
})

export const createCreditNoteSchema = z.object({
  amount: idrAmountSchema.refine((value) => value > 0n, 'Jumlah kredit harus lebih dari 0.'),
  reason: z.string().trim().min(3).max(2_000),
})

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>
export type GenerateRecurringInvoicesInput = z.infer<typeof generateRecurringInvoicesSchema>
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>
export type CreateCreditNoteInput = z.infer<typeof createCreditNoteSchema>
