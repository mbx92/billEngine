/**
 * Business document numbers are never derived with COUNT(*) + 1 (docs §16).
 * The counter lives in `document_sequences` and is allocated transactionally;
 * this module only formats the allocated number.
 */
export function formatDocumentNumber(prefix: string, sequence: bigint, width = 6): string {
  return `${prefix}-${sequence.toString().padStart(width, '0')}`
}

/** Invoices carry the year: INV-2026-000001. */
export function formatInvoiceNumber(year: string, sequence: bigint): string {
  return `INV-${year}-${sequence.toString().padStart(6, '0')}`
}

/** Calendar year of an ISO date, used as the invoice sequence period key. */
export function periodKeyOf(isoDate: string): string {
  const year = isoDate.slice(0, 4)
  if (!/^\d{4}$/.test(year)) throw new Error(`Invalid ISO date: ${isoDate}`)

  return year
}
