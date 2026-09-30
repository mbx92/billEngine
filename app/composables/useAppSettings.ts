import type { ApiBillingSettings } from '#shared/types/api'

export function useAppSettings() {
  const runtime = useRuntimeConfig().public

  return useState<ApiBillingSettings>('billing-settings', () => ({
    companyName: runtime.companyName,
    companyEmail: runtime.companyEmail || null,
    companyAddress: null,
    companyTaxId: null,
    billingTimezone: runtime.billingTimezone,
    billingCurrency: 'IDR',
    defaultTaxRate: null,
    billingAutomationEnabled: false,
    billingAccessControlEnabled: false,
    overdueGraceDays: 7,
    graceNoticeIntervalHours: 24,
    source: 'environment',
    updatedAt: null,
  }))
}
