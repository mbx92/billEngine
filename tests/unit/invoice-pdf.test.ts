import { describe, expect, it } from 'vitest'
import { generateInvoicePdf } from '../../server/services/invoices/invoice-pdf-service'

describe('invoice PDF', () => {
  it('generates a valid PDF from immutable invoice snapshots', async () => {
    const now = new Date('2026-09-29T00:00:00.000Z')
    const detail = {
      invoice: {
        id: '11111111-1111-4111-8111-111111111111',
        customerId: '22222222-2222-4222-8222-222222222222',
        invoiceNumber: 'INV-2026-000001',
        status: 'unpaid',
        currency: 'IDR',
        issueDate: '2026-09-29',
        dueDate: '2026-10-06',
        subtotalAmount: 500_000n,
        discountAmount: 0n,
        discountPercent: null,
        taxAmount: 55_000n,
        totalAmount: 555_000n,
        amountPaid: 0n,
        creditedAmount: 0n,
        balanceDue: 555_000n,
        customerName: 'Example Administrator',
        customerCompanyName: 'PT Example A',
        customerEmail: 'billing@example.test',
        customerPhone: null,
        customerAddress: 'Makassar, Indonesia',
        customerTaxId: null,
        sellerName: 'Billing Infra',
        sellerAddress: 'Indonesia',
        sellerEmail: 'billing@example.test',
        sellerTaxId: null,
        notes: 'Terima kasih.',
        issuedAt: now,
        paidAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      },
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          invoiceId: '11111111-1111-4111-8111-111111111111',
          serviceId: null,
          description: 'Production Hosting',
          quantity: '1.0000',
          unitPriceAmount: 500_000n,
          subtotalAmount: 500_000n,
          taxRate: '0.1100',
          taxAmount: 55_000n,
          totalAmount: 555_000n,
          servicePeriodStart: '2026-10-01',
          servicePeriodEnd: '2026-10-31',
          metadata: null,
          createdAt: now,
        },
      ],
      payments: [],
      creditNotes: [],
    } satisfies Parameters<typeof generateInvoicePdf>[0]

    const pdf = await generateInvoicePdf(detail)

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(2_000)
    expect(pdf.subarray(-6).toString()).toContain('%%EOF')
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1)
  })

  it('keeps a valid PDF when items wrap, include tax, and span multiple pages', async () => {
    const now = new Date('2026-09-29T00:00:00.000Z')
    const items = Array.from({ length: 12 }, (_, index) => ({
      id: `33333333-3333-4333-8333-1111111111${String(index).padStart(2, '0')}`,
      invoiceId: '11111111-1111-4111-8111-111111111111',
      serviceId: null,
      description:
        index === 0
          ? 'Production Hosting untuk cluster utama termasuk backup harian, monitoring, dan support prioritas'
          : `Add-on resource ${index + 1}`,
      quantity: '1.0000',
      unitPriceAmount: 500_000n,
      subtotalAmount: 500_000n,
      taxRate: '0.1100',
      taxAmount: 55_000n,
      totalAmount: 555_000n,
      servicePeriodStart: '2026-10-01',
      servicePeriodEnd: index === 0 ? '2026-12-31' : '2026-10-31',
      metadata: null,
      createdAt: now,
    }))
    const detail = {
      invoice: {
        id: '11111111-1111-4111-8111-111111111111',
        customerId: '22222222-2222-4222-8222-222222222222',
        invoiceNumber: 'INV-2026-000002',
        status: 'paid',
        currency: 'IDR',
        issueDate: '2026-09-29',
        dueDate: '2026-10-06',
        subtotalAmount: 6_000_000n,
        discountAmount: 0n,
        discountPercent: null,
        taxAmount: 660_000n,
        totalAmount: 6_660_000n,
        amountPaid: 6_660_000n,
        creditedAmount: 0n,
        balanceDue: 0n,
        customerName: 'Example Administrator',
        customerCompanyName: 'PT Example A',
        customerEmail: 'billing@example.test',
        customerPhone: '+62 811 0000 0000',
        customerAddress: 'Jl. Example No. 12, Makassar, Indonesia',
        customerTaxId: '10.0.1.3-000.000',
        sellerName: 'Billing Infra',
        sellerAddress: 'Indonesia',
        sellerEmail: 'billing@example.test',
        sellerTaxId: '00.000.000.0-000.000',
        notes: 'Pembayaran diterima via transfer bank.\nTerima kasih.',
        issuedAt: now,
        paidAt: now,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      },
      items,
      payments: [],
      creditNotes: [],
    } satisfies Parameters<typeof generateInvoicePdf>[0]

    const pdf = await generateInvoicePdf(detail)

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.subarray(-6).toString()).toContain('%%EOF')
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1)
  })
})
