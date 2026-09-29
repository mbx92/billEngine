import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { paymentStatus } from './enums'
import { invoices } from './invoices'

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    paymentNumber: varchar('payment_number', { length: 48 }).notNull(),
    status: paymentStatus('status').notNull().default('completed'),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    method: varchar('method', { length: 80 }).notNull(),
    reference: varchar('reference', { length: 255 }),
    notes: text('notes'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payments_payment_number_uidx').on(table.paymentNumber),
    index('payments_invoice_id_idx').on(table.invoiceId),
    index('payments_status_idx').on(table.status),
    index('payments_paid_at_idx').on(table.paidAt),
    check('payments_amount_check', sql`${table.amount} > 0`),
  ],
)
