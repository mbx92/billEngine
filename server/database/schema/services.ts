import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { users } from './auth'
import { coolifyResources } from './coolify'
import { customers } from './customers'
import { billingCycle, serviceStatus } from './enums'

export const services = pgTable(
  'services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    serviceNumber: varchar('service_number', { length: 32 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    status: serviceStatus('status').notNull().default('active'),
    currency: varchar('currency', { length: 3 }).notNull().default('IDR'),
    priceAmount: bigint('price_amount', { mode: 'bigint' }).notNull(),
    billingCycle: billingCycle('billing_cycle').notNull(),
    billingStartDate: date('billing_start_date').notNull(),
    nextDueDate: date('next_due_date'),
    invoiceLeadDays: integer('invoice_lead_days').notNull().default(0),
    paymentDueDays: integer('payment_due_days').notNull().default(7),
    taxRate: numeric('tax_rate', { precision: 7, scale: 4 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('services_service_number_uidx').on(table.serviceNumber),
    index('services_customer_id_idx').on(table.customerId),
    index('services_status_idx').on(table.status),
    index('services_next_due_date_idx').on(table.nextDueDate),
    index('services_customer_status_idx').on(table.customerId, table.status),
    check('services_price_amount_check', sql`${table.priceAmount} >= 0`),
    check('services_due_days_check', sql`${table.paymentDueDays} >= 0`),
  ],
)

export const serviceResources = pgTable(
  'service_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => coolifyResources.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('service_resources_service_resource_uidx').on(table.serviceId, table.resourceId),
    index('service_resources_service_id_idx').on(table.serviceId),
    index('service_resources_resource_id_idx').on(table.resourceId),
  ],
)
