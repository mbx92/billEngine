const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/**
 * Formats a PostgreSQL `date` value (YYYY-MM-DD) without going through `Date`,
 * so the rendered day never shifts because of timezone conversion.
 */
export function formatIsoDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'

  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return '—'

  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`
}

export function formatDateTime(isoValue: string | null | undefined, timeZone: string): string {
  if (!isoValue) return '—'

  const date = new Date(isoValue)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('id-ID', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatMoney(amount: string | number | bigint, currency = 'IDR'): string {
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return '—'

  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(numeric)
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

/** Coolify reports CPU limits as fractional cores, e.g. "1.500". */
export function formatCpuCores(value: string | null | undefined): string {
  if (!value) return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  if (numeric === 0) return 'Unlimited'
  return `${numeric.toLocaleString('id-ID', { maximumFractionDigits: 3 })} core`
}

export function formatBytes(value: string | null | undefined): string {
  if (!value) return '—'

  let bytes = Number(value)
  if (!Number.isFinite(bytes)) return '—'
  if (bytes === 0) return 'Unlimited'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  while (bytes >= 1024 && unitIndex < units.length - 1) {
    bytes /= 1024
    unitIndex += 1
  }

  return `${bytes.toLocaleString('id-ID', { maximumFractionDigits: unitIndex === 0 ? 0 : 1 })} ${units[unitIndex]}`
}

const BILLING_CYCLE_LABELS: Record<string, string> = {
  one_time: 'Sekali bayar',
  monthly: 'Bulanan',
  quarterly: 'Kuartalan',
  semi_annually: 'Semesteran',
  annually: 'Tahunan',
}

export function formatBillingCycle(cycle: string): string {
  return BILLING_CYCLE_LABELS[cycle] ?? cycle
}
