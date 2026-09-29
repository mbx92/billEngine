import { describe, expect, it } from 'vitest'
import { nextBillingDate } from '../../server/services/billing/cycles'

describe('nextBillingDate', () => {
  it('advances ordinary monthly dates', () => {
    expect(nextBillingDate('2026-09-15', 'monthly')).toBe('2026-10-15')
  })

  it('preserves end-of-month billing semantics', () => {
    expect(nextBillingDate('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(nextBillingDate('2028-01-31', 'monthly')).toBe('2028-02-29')
  })

  it('crosses years for annual and quarterly cycles', () => {
    expect(nextBillingDate('2026-11-30', 'quarterly')).toBe('2027-02-28')
    expect(nextBillingDate('2026-02-28', 'annually')).toBe('2027-02-28')
  })

  it('ends one-time billing', () => {
    expect(nextBillingDate('2026-09-29', 'one_time')).toBeNull()
  })
})
