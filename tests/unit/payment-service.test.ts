import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditLogRepository } from '../../server/repositories/audit'
import type { Database } from '../../server/database/client'
import type { InvoiceRepository } from '../../server/repositories/invoices'
import type { PaymentRepository } from '../../server/repositories/payments'
import { PaymentService } from '../../server/services/payments/payment-service'

vi.mock('../../server/utils/billing-config', () => ({
  useBillingConfig: vi.fn().mockResolvedValue({ timezone: 'Asia/Makassar' }),
}))

vi.mock('../../server/repositories/document-sequences', () => ({
  allocateDocumentNumber: vi.fn().mockResolvedValue(1n),
}))

const invoice = {
  id: 'd90c939b-2fb7-4d24-a0de-d2dac94649d3',
  status: 'paid',
  currency: 'IDR',
  totalAmount: 500_000n,
  creditedAmount: 0n,
  amountPaid: 500_000n,
  balanceDue: 0n,
  dueDate: '2020-01-01',
}

const completedPayment = { amount: 500_000n, status: 'completed' }
const refundedPayment = { amount: 125_000n, status: 'refunded' }

function setup() {
  const transaction = {}
  const database = {
    transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as Database
  const payments = {
    listByInvoice: vi
      .fn()
      .mockResolvedValueOnce([completedPayment])
      .mockResolvedValueOnce([completedPayment, refundedPayment]),
    create: vi.fn().mockResolvedValue({
      id: '296561c5-09c8-46be-8937-431b70207322',
      paymentNumber: 'PAY-000001',
      amount: 125_000n,
      status: 'refunded',
    }),
  } as unknown as PaymentRepository
  const invoices = {
    findByIdForUpdate: vi.fn().mockResolvedValue(invoice),
    applyPaymentState: vi.fn().mockImplementation(async (_transaction, _id, state) => ({
      ...invoice,
      ...state,
    })),
  } as unknown as InvoiceRepository
  const audit = { record: vi.fn() } as unknown as AuditLogRepository

  return {
    service: new PaymentService(database, payments, invoices, audit),
    payments,
    invoices,
    audit,
  }
}

describe('payment service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('locks the invoice and reopens its balance after a refund', async () => {
    const { service, invoices, audit } = setup()

    const result = await service.record(
      {
        invoiceId: invoice.id,
        amount: 125_000n,
        method: 'bank_transfer',
        status: 'refunded',
      },
      { userId: '3b9554a8-e257-4191-a45c-d59954a5d971' },
    )

    expect(invoices.findByIdForUpdate).toHaveBeenCalledWith(invoice.id, expect.anything())
    expect(invoices.applyPaymentState).toHaveBeenCalledWith(expect.anything(), invoice.id, {
      amountPaid: 375_000n,
      balanceDue: 125_000n,
      status: 'overdue',
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'payment.refunded' }),
    )
    expect(result.invoice.balanceDue).toBe(125_000n)
  })

  it('rejects a refund larger than the captured amount', async () => {
    const { service, payments } = setup()

    await expect(
      service.record(
        {
          invoiceId: invoice.id,
          amount: 500_001n,
          method: 'bank_transfer',
          status: 'refunded',
        },
        { userId: null },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    expect(payments.create).not.toHaveBeenCalled()
  })
})
