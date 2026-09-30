import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { coolifyResources, coolifyServers, customers, serviceResources, services } from './schema'

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

    const existingServers = await transaction
      .select({ id: coolifyServers.id })
      .from(coolifyServers)
      .where(eq(coolifyServers.baseUrl, 'https://coolify.example.test'))
      .limit(1)
    const [insertedServer] = existingServers.length
      ? []
      : await transaction
          .insert(coolifyServers)
          .values({ name: 'Development Coolify', baseUrl: 'https://coolify.example.test' })
          .returning({ id: coolifyServers.id })
    const server = existingServers[0] ?? insertedServer

    if (!customer || !server) throw new Error('Failed to seed parent records.')

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

    const seededResources = await transaction
      .insert(coolifyResources)
      .values([
        {
          coolifyServerId: server.id,
          coolifyUuid: 'frontend-demo',
          resourceType: 'application',
          name: 'frontend-demo',
          status: 'running',
          lastSeenAt: new Date(),
        },
        {
          coolifyServerId: server.id,
          coolifyUuid: 'backend-demo',
          resourceType: 'application',
          name: 'backend-demo',
          status: 'running',
          lastSeenAt: new Date(),
        },
      ])
      .onConflictDoUpdate({
        target: [coolifyResources.coolifyServerId, coolifyResources.coolifyUuid],
        set: { lastSeenAt: new Date(), updatedAt: new Date() },
      })
      .returning({ id: coolifyResources.id })

    if (!service) throw new Error('Failed to seed service.')
    await transaction
      .insert(serviceResources)
      .values(
        seededResources.map((resource) => ({ serviceId: service.id, resourceId: resource.id })),
      )
      .onConflictDoNothing()
  })
} finally {
  await pool.end()
}
