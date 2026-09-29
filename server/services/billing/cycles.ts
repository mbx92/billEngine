import type { BillingCycle } from '../../../shared/constants/domain'

const MONTHS_BY_CYCLE: Partial<Record<BillingCycle, number>> = {
  monthly: 1,
  quarterly: 3,
  semi_annually: 6,
  annually: 12,
}

function parseIsoDate(isoDate: string): [number, number, number] {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) throw new Error(`Invalid billing date: ${isoDate}`)
  return [year, month, day]
}

function toIsoDate(date: Date): string {
  return [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0'),
  ].join('-')
}

/** Adds whole days to an ISO date using UTC arithmetic. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = parseIsoDate(isoDate)
  return toIsoDate(new Date(Date.UTC(year, month - 1, day) + days * 86_400_000))
}

/** Advances an ISO billing date while preserving end-of-month semantics. */
export function nextBillingDate(isoDate: string, cycle: BillingCycle): string | null {
  if (cycle === 'one_time') return null

  const months = MONTHS_BY_CYCLE[cycle]
  if (!months) throw new Error(`Unsupported billing cycle: ${cycle}`)

  const [year, month, day] = parseIsoDate(isoDate)
  const sourceLastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const targetMonthIndex = month - 1 + months
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const normalizedMonthIndex = targetMonthIndex % 12
  const targetLastDay = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate()
  const targetDay = day === sourceLastDay ? targetLastDay : Math.min(day, targetLastDay)

  return [
    targetYear.toString().padStart(4, '0'),
    (normalizedMonthIndex + 1).toString().padStart(2, '0'),
    targetDay.toString().padStart(2, '0'),
  ].join('-')
}

/**
 * The period a recurring invoice covers. Rent is billed in advance, so a
 * monthly service due 2026-09-01 covers 2026-09-01..2026-09-30 and the next
 * period starts exactly one cycle later.
 *
 * A one-time service uses its billing date as a one-day service period. Its
 * next billing date remains null after that invoice has been generated.
 */
export function billingPeriod(
  isoDate: string,
  cycle: BillingCycle,
): { start: string; end: string } | null {
  if (cycle === 'one_time') return { start: isoDate, end: isoDate }

  const next = nextBillingDate(isoDate, cycle)
  if (!next) return null

  return { start: isoDate, end: addDays(next, -1) }
}

/** Whole days `dueDate` is past `today`; 0 while not yet due. */
export function daysPastDue(dueDate: string, today: string): number {
  const [dy, dm, dd] = parseIsoDate(dueDate)
  const [ty, tm, td] = parseIsoDate(today)
  const diff = Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(dy, dm - 1, dd)) / 86_400_000)
  return diff > 0 ? diff : 0
}
