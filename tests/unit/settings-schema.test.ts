import { describe, expect, it } from 'vitest'
import { updateBillingSettingsSchema } from '../../shared/schemas/settings'
import { overlayStoredBillingSettings } from '../../shared/utils/billing-settings'

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

describe('billing settings overlay', () => {
  const fallback = {
    companyName: 'OC Networks Billing',
    companyEmail: 'ops@ocnetworks.web.id',
    companyAddress: null,
    companyTaxId: null,
    billingTimezone: 'Asia/Makassar',
    billingCurrency: 'IDR',
    defaultTaxRate: null,
    billingAutomationEnabled: false,
    billingAccessControlEnabled: false,
    overdueGraceDays: 7,
    graceNoticeIntervalHours: 24,
    source: 'environment' as const,
    updatedAt: null,
  }

  it('uses the stored company name instead of the environment fallback', () => {
    const resolved = overlayStoredBillingSettings(
      fallback,
      { ...validSettings, companyName: 'PT OC Networks' },
      new Date('2026-10-08T00:00:00.000Z'),
    )

    expect(resolved.companyName).toBe('PT OC Networks')
    expect(resolved.source).toBe('database')
  })

  it('keeps a valid stored company name when another field is stale', () => {
    const resolved = overlayStoredBillingSettings(
      fallback,
      {
        companyName: 'PT OC Networks',
        billingTimezone: 'Makassar',
        defaultTaxRate: '11',
      },
      '2026-10-08T00:00:00.000Z',
    )

    expect(resolved.companyName).toBe('PT OC Networks')
    expect(resolved.billingTimezone).toBe('Asia/Makassar')
    expect(resolved.source).toBe('database')
  })
})
