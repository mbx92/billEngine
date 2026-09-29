import { asc, eq } from 'drizzle-orm'
import { useDatabase, type Database } from '../database/client'
import { customers } from '../database/schema'

export interface CustomerOption {
  id: string
  customerNumber: string
  name: string
  companyName: string | null
  email: string
}

/** Minimal customer list for select inputs; active customers only. */
export class CustomerOptionRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async list(): Promise<CustomerOption[]> {
    return this.database
      .select({
        id: customers.id,
        customerNumber: customers.customerNumber,
        name: customers.name,
        companyName: customers.companyName,
        email: customers.email,
      })
      .from(customers)
      .where(eq(customers.status, 'active'))
      .orderBy(asc(customers.name))
  }
}
