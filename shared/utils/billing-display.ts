import type { BillingCycle } from '../constants/domain'

const CYCLE_UNITS: Record<BillingCycle, string> = {
  one_time: 'sekali bayar',
  monthly: 'bulan',
  quarterly: '3 bulan',
  semi_annually: '6 bulan',
  annually: 'tahun',
}

export function billingCycleUnit(cycle: BillingCycle): string {
  return CYCLE_UNITS[cycle]
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return date
}

/** Number of billing months covered by an inclusive recurring period. */
export function billingPeriodMonths(start: string | null, end: string | null): number {
  if (!start || !end) return 0
  const startDate = parseIsoDate(start)
  const inclusiveEndDate = parseIsoDate(end)
  if (!startDate || !inclusiveEndDate || inclusiveEndDate < startDate) return 0

  // Invoice periods are inclusive. Moving the end forward one day restores
  // the next billing boundary, including end-of-month cycles such as
  // 31 January through 29 April (a three-month period).
  const endDate = new Date(inclusiveEndDate.getTime() + 86_400_000)
  const months =
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    endDate.getUTCMonth() -
    startDate.getUTCMonth()

  return months > 0 ? months : 0
}

/** Rounded monthly equivalent while keeping the invoice total authoritative. */
export function monthlyEquivalent(amount: bigint, months: number): bigint {
  if (!Number.isInteger(months) || months <= 0) return amount
  const divisor = BigInt(months)
  return (amount + divisor / 2n) / divisor
}
