import { describe, expect, it } from 'vitest'
import {
  billingCycleUnit,
  billingPeriodMonths,
  monthlyEquivalent,
} from '../../shared/utils/billing-display'

describe('billing display helpers', () => {
  it('describes a price as belonging to its selected cycle', () => {
    expect(billingCycleUnit('monthly')).toBe('bulan')
    expect(billingCycleUnit('quarterly')).toBe('3 bulan')
    expect(billingCycleUnit('semi_annually')).toBe('6 bulan')
    expect(billingCycleUnit('annually')).toBe('tahun')
  })

  it('derives month counts from inclusive invoice service periods', () => {
    expect(billingPeriodMonths('2026-01-01', '2026-12-31')).toBe(12)
    expect(billingPeriodMonths('2026-01-31', '2026-04-29')).toBe(3)
    expect(billingPeriodMonths('2026-09-01', '2026-09-30')).toBe(1)
    expect(billingPeriodMonths('not-a-date', '2026-09-30')).toBe(0)
  })

  it('calculates a rounded monthly equivalent without changing the cycle total', () => {
    expect(monthlyEquivalent(6_000_000n, 12)).toBe(500_000n)
    expect(monthlyEquivalent(1_000_000n, 3)).toBe(333_333n)
  })
})
