import { describe, expect, it } from 'vitest'
import { updateBillingSettingsSchema } from '../../shared/schemas/settings'

const validSettings = {
  companyName: 'PT Billing Infrastruktur',
  companyEmail: 'billing@example.test',
  companyAddress: 'Makassar',
  companyTaxId: '01.234.567.8-999.000',
  billingTimezone: 'Asia/Makassar',
  billingCurrency: 'idr',
  defaultTaxRate: '0.11',
  billingAutomationEnabled: true,
  billingAccessControlEnabled: true,
  overdueGraceDays: 7,
  graceNoticeIntervalHours: 24,
}

describe('billing settings schema', () => {
  it('normalizes optional fields and currency', () => {
    expect(
      updateBillingSettingsSchema.parse({
        ...validSettings,
        companyEmail: '',
        companyAddress: '',
        companyTaxId: '',
        defaultTaxRate: '',
      }),
    ).toMatchObject({
      companyEmail: null,
      companyAddress: null,
      companyTaxId: null,
      billingCurrency: 'IDR',
      defaultTaxRate: null,
      billingAutomationEnabled: true,
      billingAccessControlEnabled: true,
      overdueGraceDays: 7,
      graceNoticeIntervalHours: 24,
    })
  })

  it('keeps billing automation disabled for legacy settings', () => {
    const {
      billingAutomationEnabled: _automation,
      billingAccessControlEnabled: _access,
      overdueGraceDays: _grace,
      graceNoticeIntervalHours: _notice,
      ...legacySettings
    } = validSettings
    expect(updateBillingSettingsSchema.parse(legacySettings)).toMatchObject({
      billingAutomationEnabled: false,
      billingAccessControlEnabled: false,
      overdueGraceDays: 7,
      graceNoticeIntervalHours: 24,
    })
  })

  it('accepts a valid IANA timezone and fractional tax rate', () => {
    expect(updateBillingSettingsSchema.parse(validSettings)).toMatchObject({
      billingTimezone: 'Asia/Makassar',
      defaultTaxRate: '0.11',
    })
  })

  it('rejects invalid timezone and tax rate', () => {
    expect(() =>
      updateBillingSettingsSchema.parse({
        ...validSettings,
        billingTimezone: 'Makassar',
        defaultTaxRate: '11',
      }),
    ).toThrow()
  })

  it('bounds access-control timing settings', () => {
    expect(() =>
      updateBillingSettingsSchema.parse({ ...validSettings, overdueGraceDays: 91 }),
    ).toThrow()
    expect(() =>
      updateBillingSettingsSchema.parse({ ...validSettings, graceNoticeIntervalHours: 0 }),
    ).toThrow()
  })
})
