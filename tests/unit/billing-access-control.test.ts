import { describe, expect, it, vi } from 'vitest'
import type { BillingAccessRepository } from '../../server/repositories/billing-access'
import { BillingAccessControlService } from '../../server/services/billing/access-control-service'
import type { SettingsService } from '../../server/services/settings/settings-service'

const settings = {
  billingAccessControlEnabled: true,
  billingTimezone: 'Asia/Makassar',
  overdueGraceDays: 7,
  graceNoticeIntervalHours: 24,
}

describe('billing access control service', () => {
  it('does no lookup when access control is disabled', async () => {
    const repository = {
      findServiceByHost: vi.fn(),
      findOldestOpenOverdueInvoice: vi.fn(),
    } as unknown as BillingAccessRepository
    const settingsService = {
      getBillingSettings: vi.fn().mockResolvedValue({
        ...settings,
        billingAccessControlEnabled: false,
      }),
    } as unknown as SettingsService

    const decision = await new BillingAccessControlService(repository, settingsService).evaluate(
      'app.example.test',
      'secret',
      '2026-09-18',
    )

    expect(decision.state).toBe('normal')
    expect(repository.findServiceByHost).not.toHaveBeenCalled()
  })

  it('returns grace and blocked decisions from the oldest open invoice', async () => {
    const repository = {
      findServiceByHost: vi.fn().mockResolvedValue({
        id: 'service-1',
        name: 'Customer app',
        serviceNumber: 'SVC-1',
      }),
      findOldestOpenOverdueInvoice: vi.fn().mockResolvedValue({
        id: 'invoice-1',
        invoiceNumber: 'INV-1',
        dueDate: '2026-09-10',
        balanceDue: 100n,
      }),
    } as unknown as BillingAccessRepository
    const settingsService = {
      getBillingSettings: vi.fn().mockResolvedValue(settings),
    } as unknown as SettingsService
    const service = new BillingAccessControlService(repository, settingsService)

    await expect(
      service.evaluate('app.example.test', 'secret', '2026-09-17'),
    ).resolves.toMatchObject({ state: 'grace', daysPastDue: 7, graceEndsAt: '2026-09-17' })
    await expect(
      service.evaluate('app.example.test', 'secret', '2026-09-18'),
    ).resolves.toMatchObject({ state: 'blocked', daysPastDue: 8 })
  })
})
