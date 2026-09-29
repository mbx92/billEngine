import { asc, count, eq, sql } from 'drizzle-orm'
import type { CreateCustomerInput } from '../../shared/schemas/customers'
import type { ApiCustomer } from '../../shared/types/api'
import { useDatabase, type Database } from '../database/client'
import { customers, services } from '../database/schema'
import { allocateDocumentNumber, ensureDocumentSequenceFloor } from './document-sequences'
import { formatDocumentNumber } from '../utils/document-number'

export type CustomerRecord = typeof customers.$inferSelect

export class CustomerRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async findById(id: string): Promise<CustomerRecord | null> {
    const [customer] = await this.database
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1)

    return customer ?? null
  }

  async list(page: number, perPage: number) {
    const offset = (page - 1) * perPage
    const [rows, totals] = await Promise.all([
      this.database
        .select({
          id: customers.id,
          customerNumber: customers.customerNumber,
          name: customers.name,
          companyName: customers.companyName,
          email: customers.email,
          status: customers.status,
          city: customers.city,
          countryCode: customers.countryCode,
          createdAt: customers.createdAt,
          totalServiceCount: count(services.id),
          activeServiceCount:
            sql<number>`count(${services.id}) filter (where ${services.status} = 'active')`.mapWith(
              Number,
            ),
        })
        .from(customers)
        .leftJoin(services, eq(services.customerId, customers.id))
        .groupBy(customers.id)
        .orderBy(asc(customers.name))
        .limit(perPage)
        .offset(offset),
      this.database.select({ total: count() }).from(customers),
    ])

    return { rows: rows.map(toApiCustomer), total: totals[0]?.total ?? 0 }
  }

  async findByNumber(customerNumber: string) {
    const [customer] = await this.database
      .select()
      .from(customers)
      .where(eq(customers.customerNumber, customerNumber))
      .limit(1)
    return customer ?? null
  }

  async create(input: CreateCustomerInput) {
    return this.database.transaction(async (transaction) => {
      const [floor] = await transaction
        .select({
          value: sql<string>`coalesce(max(substring(${customers.customerNumber} from '([0-9]+)$')::bigint), 0)::text`,
        })
        .from(customers)
      await ensureDocumentSequenceFloor(
        transaction,
        'customer',
        'global',
        BigInt(floor?.value ?? '0'),
      )
      const sequence = await allocateDocumentNumber(transaction, 'customer', 'global')
      const customerNumber = formatDocumentNumber('CUS', sequence)

      const [customer] = await transaction
        .insert(customers)
        .values({ ...input, customerNumber })
        .returning()

      if (!customer) throw new Error('Failed to create customer.')
      return customer
    })
  }
}

type CustomerListRow = {
  id: string
  customerNumber: string
  name: string
  companyName: string | null
  email: string
  status: 'active' | 'inactive'
  city: string | null
  countryCode: string
  createdAt: Date
  totalServiceCount: number
  activeServiceCount: number
}

function toApiCustomer(row: CustomerListRow): ApiCustomer {
  return {
    id: row.id,
    customerNumber: row.customerNumber,
    name: row.name,
    companyName: row.companyName,
    email: row.email,
    status: row.status,
    city: row.city,
    countryCode: row.countryCode,
    totalServiceCount: Number(row.totalServiceCount),
    activeServiceCount: Number(row.activeServiceCount),
    createdAt: row.createdAt.toISOString(),
  }
}
