import { describe, expect, it } from 'vitest'
import {
  invoicePaymentState,
  invoiceStateFromNet,
  summarizePaymentEffect,
} from '../../server/services/payments/status'

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

  it('reopens the remaining balance after a refund', () => {
    const effect = summarizePaymentEffect([
      { amount: 500_000n, status: 'completed' },
      { amount: 125_000n, status: 'refunded' },
    ])

    expect(effect).toEqual({ captured: 500_000n, refunded: 125_000n, net: 375_000n })
    expect(invoiceStateFromNet(500_000n, effect.net, false)).toEqual({
      amountPaid: 375_000n,
      balanceDue: 125_000n,
      status: 'unpaid',
    })
  })

  it('never persists a negative paid amount for legacy inconsistent refund data', () => {
    expect(invoiceStateFromNet(500_000n, -50_000n, false)).toEqual({
      amountPaid: 0n,
      balanceDue: 500_000n,
      status: 'unpaid',
    })
  })
})
