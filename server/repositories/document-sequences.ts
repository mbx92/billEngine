import { and, eq, sql } from 'drizzle-orm'
import { documentSequences } from '../database/schema'
import type { Database, Transaction } from '../database/client'

export type SequenceKind = 'customer' | 'service' | 'invoice' | 'payment' | 'credit_note'

/**
 * Allocates the next document number for a type/period inside the caller's
 * transaction. The upsert takes a row lock, so concurrent allocations cannot
 * hand out the same number (docs §16: never use COUNT(*) + 1).
 *
 * Callers must pass their transaction handle so a failed write rolls the
 * allocation back with the record it belongs to, leaving no gaps.
 */
export async function allocateDocumentNumber(
  transaction: Transaction,
  documentType: SequenceKind,
  periodKey: string,
): Promise<bigint> {
  const [sequence] = await transaction
    .insert(documentSequences)
    .values({ documentType, periodKey, lastNumber: 1n })
    .onConflictDoUpdate({
      target: [documentSequences.documentType, documentSequences.periodKey],
      set: { lastNumber: sql`${documentSequences.lastNumber} + 1` },
    })
    .returning({ lastNumber: documentSequences.lastNumber })

  if (!sequence) throw new Error(`Failed to allocate ${documentType} number.`)
  return sequence.lastNumber
}

/**
 * Raises a counter to at least `floor` before allocating a new number. This is
 * needed for databases that already contain seeded/imported document numbers
 * but do not yet have the matching sequence row.
 */
export async function ensureDocumentSequenceFloor(
  transaction: Transaction,
  documentType: SequenceKind,
  periodKey: string,
  floor: bigint,
) {
  await transaction
    .insert(documentSequences)
    .values({ documentType, periodKey, lastNumber: floor })
    .onConflictDoUpdate({
      target: [documentSequences.documentType, documentSequences.periodKey],
      set: {
        lastNumber: sql`greatest(${documentSequences.lastNumber}, ${floor})`,
      },
    })
}

/** Peeks at the current counter without consuming it. */
export async function peekDocumentNumber(
  database: Database,
  documentType: SequenceKind,
  periodKey: string,
): Promise<bigint> {
  const [row] = await database
    .select({ lastNumber: documentSequences.lastNumber })
    .from(documentSequences)
    .where(
      and(
        eq(documentSequences.documentType, documentType),
        eq(documentSequences.periodKey, periodKey),
      ),
    )
    .limit(1)

  return row?.lastNumber ?? 0n
}
