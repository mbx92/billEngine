/**
 * Billing timezone decides which calendar day counts as "today" for every
 * billing decision (issue dates, due dates, overdue detection).
 */
export function todayIsoDate(timeZone?: string): string {
  const zone = timeZone ?? useRuntimeConfig().billingTimezone ?? 'UTC'

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
