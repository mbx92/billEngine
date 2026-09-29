import { SettingsService } from '../services/settings/settings-service'

export interface BillingSeller {
  name: string
  email: string | null
  address: string | null
  taxId: string | null
}

export interface BillingConfig {
  timezone: string
  currency: string
  /** Default tax rate as a numeric(7,4) fraction, e.g. "0.11" for 11%. */
  defaultTaxRate: string | null
  billingAutomationEnabled: boolean
  companyName: string
  seller: BillingSeller
}

/**
 * Company identity and billing defaults come from server-side configuration,
 * not from hardcoded constants (docs §17: tax must be configurable).
 */
export async function useBillingConfig(): Promise<BillingConfig> {
  const settings = await new SettingsService().getBillingSettings()

  return {
    timezone: settings.billingTimezone,
    currency: settings.billingCurrency,
    defaultTaxRate: settings.defaultTaxRate,
    billingAutomationEnabled: settings.billingAutomationEnabled,
    companyName: settings.companyName,
    seller: {
      name: settings.companyName,
      email: settings.companyEmail,
      address: settings.companyAddress,
      taxId: settings.companyTaxId,
    },
  }
}
