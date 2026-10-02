import 'dotenv/config'
import { hashPassword } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { accounts, users } from './schema'

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD
const name = process.env.ADMIN_NAME?.trim() || 'Platform Administrator'
const databaseUrl = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL

if (!databaseUrl || !email || !password) {
  throw new Error(
    'NUXT_DATABASE_URL (or legacy DATABASE_URL), ADMIN_EMAIL, and ADMIN_PASSWORD are required.',
  )
}

if (password.length < 12) {
  throw new Error('ADMIN_PASSWORD must be at least 12 characters.')
}

const pool = new pg.Pool({ connectionString: databaseUrl })
const database = drizzle(pool)
let created = false

try {
  await database.transaction(async (transaction) => {
    const existing = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    if (existing.length) return

    const userId = crypto.randomUUID()
    await transaction.insert(users).values({
      id: userId,
      name,
      email,
      emailVerified: true,
      role: 'super_admin',
    })
    await transaction.insert(accounts).values({
      accountId: userId,
      providerId: 'credential',
      userId,
      password: await hashPassword(password),
    })
    created = true
  })
  console.log(created ? `Created super admin: ${email}` : `Super admin already exists: ${email}`)
} finally {
  await pool.end()
}
