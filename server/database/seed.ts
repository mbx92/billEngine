import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { customers, services } from './schema'

if (process.env.NODE_ENV === 'production') {
  throw new Error('Development seed is disabled in production.')
}

const databaseUrl = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('NUXT_DATABASE_URL (or legacy DATABASE_URL) is required.')
}

const pool = new pg.Pool({ connectionString: databaseUrl })
const database = drizzle(pool)

try {
  await database.transaction(async (transaction) => {
    const [customer] = await transaction
      .insert(customers)
      .values({
        customerNumber: 'CUS-000001',
        name: 'Example Administrator',
        companyName: 'PT Example A',
        email: 'billing@example.test',
        countryCode: 'ID',
      })
      .onConflictDoUpdate({
        target: customers.customerNumber,
        set: { updatedAt: new Date() },
      })
      .returning({ id: customers.id })

    if (!customer) throw new Error('Failed to seed customer.')

    const [service] = await transaction
      .insert(services)
      .values({
        customerId: customer.id,
        serviceNumber: 'SVC-000001',
        name: 'Production Hosting',
        priceAmount: 500_000n,
        billingCycle: 'monthly',
        billingStartDate: '2026-01-01',
        nextDueDate: '2026-10-01',
      })
      .onConflictDoUpdate({ target: services.serviceNumber, set: { updatedAt: new Date() } })
      .returning({ id: services.id })

    if (!service) throw new Error('Failed to seed service.')
  })
} finally {
  await pool.end()
}
