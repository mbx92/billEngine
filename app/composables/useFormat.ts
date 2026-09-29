import {
  formatBillingCycle,
  formatBytes,
  formatCount,
  formatCpuCores,
  formatDateTime,
  formatIsoDate,
  formatMoney,
} from '~/lib/format'

/** Formatters bound to the configured billing timezone. */
export function useFormat() {
  const settings = useAppSettings()

  return {
    date: formatIsoDate,
    dateTime: (value: string | null | undefined) =>
      formatDateTime(value, settings.value.billingTimezone),
    money: formatMoney,
    count: formatCount,
    cpu: formatCpuCores,
    bytes: formatBytes,
    billingCycle: formatBillingCycle,
  }
}
