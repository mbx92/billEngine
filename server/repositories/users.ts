import { and, asc, count, eq, ne } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import type { CreateUserInput, UpdateUserAccessInput } from '../../shared/schemas/users'
import { useDatabase, type Database, type Transaction } from '../database/client'
import { accounts, customers, sessions, users } from '../database/schema'

export class UserRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async list() {
    return this.database
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        customerId: users.customerId,
        customerName: customers.name,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(customers, eq(customers.id, users.customerId))
      .orderBy(asc(users.name))
  }

  async findByEmail(email: string) {
    const [row] = await this.database.select().from(users).where(eq(users.email, email)).limit(1)
    return row ?? null
  }

  async findById(id: string, transaction: Transaction | Database = this.database) {
    const [row] = await transaction.select().from(users).where(eq(users.id, id)).limit(1)
    return row ?? null
  }

  async countOtherSuperAdmins(transaction: Transaction, userId: string) {
    const [row] = await transaction
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, 'super_admin'), ne(users.id, userId)))
    return row?.total ?? 0
  }

  async create(transaction: Transaction, input: CreateUserInput) {
    const userId = crypto.randomUUID()
    const [created] = await transaction
      .insert(users)
      .values({
        id: userId,
        name: input.name,
        email: input.email,
        emailVerified: true,
        role: input.role,
        customerId: input.role === 'customer' ? input.customerId : null,
      })
      .returning()
    if (!created) throw new Error('Failed to create user.')

    await transaction.insert(accounts).values({
      accountId: userId,
      providerId: 'credential',
      userId,
      password: await hashPassword(input.password),
    })
    return created
  }

  async updateAccess(transaction: Transaction, id: string, input: UpdateUserAccessInput) {
    const [updated] = await transaction
      .update(users)
      .set({
        role: input.role,
        customerId:
          input.role === 'customer'
            ? (input.customerId ?? null)
            : input.role
              ? null
              : input.customerId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning()
    if (!updated) throw new Error('Failed to update user access.')

    await transaction.delete(sessions).where(eq(sessions.userId, id))
    return updated
  }
}
