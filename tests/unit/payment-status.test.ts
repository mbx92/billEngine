import { describe, expect, it } from 'vitest'
import { invoicePaymentState } from '../../server/services/payments/status'

describe('invoicePaymentState', () => {
  it('keeps a partially paid invoice unpaid', () => {
    expect(invoicePaymentState(500_000n, [200_000n], false)).toEqual({
      amountPaid: 200_000n,
      balanceDue: 300_000n,
      status: 'unpaid',
    })
  })

  it('marks the remaining balance overdue after the due date', () => {
    expect(invoicePaymentState(500_000n, [200_000n], true).status).toBe('overdue')
  })

  it('marks full or excess payment as paid without a negative balance', () => {
    expect(invoicePaymentState(500_000n, [550_000n], true)).toEqual({
      amountPaid: 550_000n,
      balanceDue: 0n,
      status: 'paid',
    })
  })
})
