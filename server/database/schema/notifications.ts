import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { invoices } from './invoices'
import { emailDeliveryStatus } from './enums'

export const emailDeliveries = pgTable(
  'email_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 48 }).notNull(),
    recipient: varchar('recipient', { length: 320 }).notNull(),
    subject: varchar('subject', { length: 300 }).notNull(),
    status: emailDeliveryStatus('status').notNull().default('pending'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('email_deliveries_idempotency_uidx').on(table.idempotencyKey),
    index('email_deliveries_invoice_id_idx').on(table.invoiceId),
    index('email_deliveries_status_idx').on(table.status),
  ],
)
