import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { customers } from './customers'
import { creditNoteStatus, invoiceStatus } from './enums'
import { services } from './services'
import { users } from './auth'

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    invoiceNumber: varchar('invoice_number', { length: 48 }).notNull(),
    status: invoiceStatus('status').notNull().default('draft'),
    currency: varchar('currency', { length: 3 }).notNull(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    subtotalAmount: bigint('subtotal_amount', { mode: 'bigint' }).notNull(),
    discountAmount: bigint('discount_amount', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    discountPercent: numeric('discount_percent', { precision: 7, scale: 4 }),
    taxAmount: bigint('tax_amount', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    totalAmount: bigint('total_amount', { mode: 'bigint' }).notNull(),
    amountPaid: bigint('amount_paid', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    creditedAmount: bigint('credited_amount', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    balanceDue: bigint('balance_due', { mode: 'bigint' }).notNull(),
    customerName: varchar('customer_name', { length: 160 }).notNull(),
    customerCompanyName: varchar('customer_company_name', { length: 200 }),
    customerEmail: varchar('customer_email', { length: 320 }).notNull(),
    customerPhone: varchar('customer_phone', { length: 40 }),
    customerAddress: text('customer_address'),
    customerTaxId: varchar('customer_tax_id', { length: 80 }),
    sellerName: varchar('seller_name', { length: 200 }).notNull(),
    sellerAddress: text('seller_address'),
    sellerEmail: varchar('seller_email', { length: 320 }),
    sellerTaxId: varchar('seller_tax_id', { length: 80 }),
    notes: text('notes'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoices_invoice_number_uidx').on(table.invoiceNumber),
    index('invoices_customer_id_idx').on(table.customerId),
    index('invoices_status_idx').on(table.status),
    index('invoices_due_date_idx').on(table.dueDate),
    index('invoices_customer_status_idx').on(table.customerId, table.status),
    check('invoices_subtotal_amount_check', sql`${table.subtotalAmount} >= 0`),
    check('invoices_discount_amount_check', sql`${table.discountAmount} >= 0`),
    check('invoices_tax_amount_check', sql`${table.taxAmount} >= 0`),
    check('invoices_total_amount_check', sql`${table.totalAmount} >= 0`),
    check('invoices_amount_paid_check', sql`${table.amountPaid} >= 0`),
    check('invoices_credited_amount_check', sql`${table.creditedAmount} >= 0`),
    check('invoices_balance_due_check', sql`${table.balanceDue} >= 0`),
  ],
)

export const creditNotes = pgTable(
  'credit_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    creditNoteNumber: varchar('credit_note_number', { length: 48 }).notNull(),
    status: creditNoteStatus('status').notNull().default('issued'),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    reason: text('reason').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('credit_notes_number_uidx').on(table.creditNoteNumber),
    index('credit_notes_invoice_id_idx').on(table.invoiceId),
    index('credit_notes_status_idx').on(table.status),
    check('credit_notes_amount_check', sql`${table.amount} > 0`),
  ],
)

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull().default('1'),
    unitPriceAmount: bigint('unit_price_amount', { mode: 'bigint' }).notNull(),
    subtotalAmount: bigint('subtotal_amount', { mode: 'bigint' }).notNull(),
    taxRate: numeric('tax_rate', { precision: 7, scale: 4 }),
    taxAmount: bigint('tax_amount', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    totalAmount: bigint('total_amount', { mode: 'bigint' }).notNull(),
    servicePeriodStart: date('service_period_start'),
    servicePeriodEnd: date('service_period_end'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invoice_items_invoice_id_idx').on(table.invoiceId),
    index('invoice_items_service_id_idx').on(table.serviceId),
  ],
)

export const serviceBillingRuns = pgTable(
  'service_billing_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('service_billing_runs_service_period_uidx').on(
      table.serviceId,
      table.periodStart,
      table.periodEnd,
    ),
    index('service_billing_runs_invoice_id_idx').on(table.invoiceId),
  ],
)
