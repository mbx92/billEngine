import { describe, expect, it, vi } from 'vitest'
import type { JobRunRepository } from '../../server/repositories/audit'
import type { InvoiceService } from '../../server/services/invoices/invoice-service'
import type { SettingsService } from '../../server/services/settings/settings-service'
import { BillingAutomationService } from '../../server/services/billing/automation-service'

describe('billing automation service', () => {
  it('does no billing work while automation is disabled', async () => {
    const settings = {
      getBillingSettings: vi.fn().mockResolvedValue({ billingAutomationEnabled: false }),
    } as unknown as SettingsService
    const invoices = {
      generateRecurring: vi.fn(),
      markOverdue: vi.fn(),
    } as unknown as InvoiceService
    const jobs = { start: vi.fn(), finish: vi.fn() } as unknown as JobRunRepository

    const result = await new BillingAutomationService(settings, invoices, jobs).run()

    expect(result).toEqual({ status: 'disabled' })
    expect(invoices.generateRecurring).not.toHaveBeenCalled()
    expect(jobs.start).not.toHaveBeenCalled()
  })

  it('runs recurring and overdue work when enabled', async () => {
    const settings = {
      getBillingSettings: vi.fn().mockResolvedValue({
        billingAutomationEnabled: true,
        billingTimezone: 'Asia/Makassar',
      }),
    } as unknown as SettingsService
    const invoices = {
      generateRecurring: vi.fn().mockResolvedValue({
        asOf: '2026-09-30',
        created: [{ invoiceId: 'invoice-1' }],
        skipped: [],
        processed: 1,
      }),
      markOverdue: vi.fn().mockResolvedValue({ marked: 2, invoiceIds: [] }),
    } as unknown as InvoiceService
    const jobs = {
      start: vi.fn().mockResolvedValue({ id: 'job-1' }),
      finish: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobRunRepository

    const result = await new BillingAutomationService(settings, invoices, jobs).run()

    expect(result.status).toBe('completed')
    expect(invoices.generateRecurring).toHaveBeenCalledWith(
      { asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), limit: 500 },
      expect.objectContaining({ userId: null }),
    )
    expect(invoices.markOverdue).toHaveBeenCalled()
    expect(jobs.finish).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: 'completed', processedCount: 3 }),
    )
  })
})
