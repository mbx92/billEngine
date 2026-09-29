import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'
import { customerStatus } from './enums'

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerNumber: varchar('customer_number', { length: 32 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    companyName: varchar('company_name', { length: 200 }),
    email: varchar('email', { length: 320 }).notNull(),
    phone: varchar('phone', { length: 40 }),
    addressLine1: varchar('address_line_1', { length: 255 }),
    addressLine2: varchar('address_line_2', { length: 255 }),
    city: varchar('city', { length: 120 }),
    province: varchar('province', { length: 120 }),
    postalCode: varchar('postal_code', { length: 20 }),
    countryCode: varchar('country_code', { length: 2 }).notNull().default('ID'),
    taxId: varchar('tax_id', { length: 80 }),
    status: customerStatus('status').notNull().default('active'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('customers_customer_number_uidx').on(table.customerNumber),
    index('customers_status_idx').on(table.status),
  ],
)
