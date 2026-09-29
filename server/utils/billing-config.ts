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
  companyName: string
  seller: BillingSeller
}

/**
 * Company identity and billing defaults come from server-side configuration,
 * not from hardcoded constants (docs §17: tax must be configurable).
 */
export function useBillingConfig(): BillingConfig {
  const config = useRuntimeConfig()

  return {
    timezone: config.billingTimezone || 'UTC',
    currency: config.billingCurrency || 'IDR',
    defaultTaxRate: config.billingDefaultTaxRate || null,
    companyName: config.companyName,
    seller: {
      name: config.companyName,
      email: config.companyEmail || null,
      address: config.companyAddress || null,
      taxId: config.companyTaxId || null,
    },
  }
}
