import { desc, eq } from 'drizzle-orm'
import { useDatabase, type Database, type Transaction } from '../database/client'
import { creditNotes } from '../database/schema'

export class CreditNoteRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  listByInvoice(invoiceId: string) {
    return this.database
      .select()
      .from(creditNotes)
      .where(eq(creditNotes.invoiceId, invoiceId))
      .orderBy(desc(creditNotes.issuedAt))
  }

  async create(
    transaction: Transaction,
    input: {
      invoiceId: string
      creditNoteNumber: string
      amount: bigint
      reason: string
      createdBy: string | null
    },
  ) {
    const [created] = await transaction.insert(creditNotes).values(input).returning()
    if (!created) throw new Error('Failed to create credit note.')
    return created
  }
}
