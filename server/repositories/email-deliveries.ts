import { eq, sql } from 'drizzle-orm'
import { useDatabase, type Database } from '../database/client'
import { emailDeliveries } from '../database/schema'

export class EmailDeliveryRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async reserve(input: {
    invoiceId: string
    kind: string
    recipient: string
    subject: string
    idempotencyKey: string
  }) {
    const inserted = await this.database
      .insert(emailDeliveries)
      .values(input)
      .onConflictDoNothing({ target: emailDeliveries.idempotencyKey })
      .returning()
    if (inserted[0]) return inserted[0]

    const [existing] = await this.database
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.idempotencyKey, input.idempotencyKey))
      .limit(1)
    if (!existing) throw new Error('Failed to reserve email delivery.')
    return existing
  }

  async markAttempt(id: string) {
    await this.database
      .update(emailDeliveries)
      .set({
        status: 'pending',
        attemptCount: sql`${emailDeliveries.attemptCount} + 1`,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(emailDeliveries.id, id))
  }

  async markSent(id: string, providerMessageId: string) {
    await this.database
      .update(emailDeliveries)
      .set({ status: 'sent', providerMessageId, sentAt: new Date(), updatedAt: new Date() })
      .where(eq(emailDeliveries.id, id))
  }

  async markFailed(id: string, error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown email delivery error.'
    await this.database
      .update(emailDeliveries)
      .set({ status: 'failed', lastError: message.slice(0, 2_000), updatedAt: new Date() })
      .where(eq(emailDeliveries.id, id))
  }
}
