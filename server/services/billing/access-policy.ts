import { addDays, daysPastDue } from './cycles'

export type BillingAccessState = 'normal' | 'grace' | 'blocked'

export interface BillingAccessWindow {
  state: Exclude<BillingAccessState, 'normal'>
  daysPastDue: number
  graceEndsAt: string
}

/**
 * The due date itself is not overdue. A seven-day grace period covers days
 * 1..7 past due and blocks access starting on day 8.
 */
export function overdueAccessWindow(
  dueDate: string,
  asOf: string,
  graceDays: number,
): BillingAccessWindow | null {
  const overdueDays = daysPastDue(dueDate, asOf)
  if (overdueDays === 0) return null

  return {
    state: overdueDays <= graceDays ? 'grace' : 'blocked',
    daysPastDue: overdueDays,
    graceEndsAt: addDays(dueDate, graceDays),
  }
}

export function normalizeRequestHost(value: string | null | undefined): string | null {
  if (!value) return null

  const first = value.split(',')[0]?.trim().toLowerCase()
  if (!first || /[\s/\\]/.test(first)) return null

  // Forwarded hosts are normally DNS names. Bracketed IPv6 is retained while
  // the port is removed from ordinary host:port values.
  if (first.startsWith('[')) {
    const closing = first.indexOf(']')
    return closing > 0 ? first.slice(0, closing + 1) : null
  }

  return first.replace(/:\d+$/, '').replace(/\.$/, '') || null
}

export function hostsFromCoolifyFqdn(value: string | null): string[] {
  if (!value) return []

  return value
    .split(',')
    .map((entry) => entry.trim())
    .flatMap((entry) => {
      if (!entry) return []
      try {
        const url = new URL(entry.includes('://') ? entry : `https://${entry}`)
        const host = normalizeRequestHost(url.host)
        return host ? [host] : []
      } catch {
        return []
      }
    })
}

export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\r\n]/.test(value)) return '/'
  return value.slice(0, 2_048)
}
