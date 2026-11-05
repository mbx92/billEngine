import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => vi.unstubAllEnvs())

  it('uses an explicit host-scoped test state without querying the database', async () => {
    vi.stubEnv('BILLING_GATE_TEST_HOST', 'opswiki.example.test')
    vi.stubEnv('BILLING_GATE_TEST_STATE', 'grace')
    const repository = {
      findServiceByHost: vi.fn(),
      findOldestOpenOverdueInvoice: vi.fn(),
    } as unknown as BillingAccessRepository
    const settingsService = {
      getBillingSettings: vi.fn(),
    } as unknown as SettingsService

    const decision = await new BillingAccessControlService(repository, settingsService).evaluate(
      'opswiki.example.test',
      'secret',
      '2026-09-30',
    )

    expect(decision).toMatchObject({ state: 'grace', daysPastDue: 1, graceEndsAt: '2026-10-06' })
    expect(settingsService.getBillingSettings).not.toHaveBeenCalled()
    expect(repository.findServiceByHost).not.toHaveBeenCalled()
  })

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

  it.each([0n, 100n])(
    'returns grace and blocked decisions regardless of balance %s',
    async (balanceDue) => {
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
          balanceDue,
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
    },
  )

  it.each(['suspended', 'cancelled'])(
    'blocks %s services even without an invoice',
    async (status) => {
      const repository = {
        findServiceByHost: vi
          .fn()
          .mockResolvedValue({ id: 's1', name: 'App', serviceNumber: 'SVC-1', status }),
        findOldestOpenOverdueInvoice: vi.fn(),
      }
      const settingsService = { getBillingSettings: vi.fn().mockResolvedValue(settings) }
      const gate = new BillingAccessControlService(repository as never, settingsService as never)

      await expect(gate.evaluate('app.example.test', 'secret')).resolves.toMatchObject({
        state: status,
        invoice: null,
      })
      expect(repository.findOldestOpenOverdueInvoice).not.toHaveBeenCalled()
    },
  )

  it('opens access after payment without contacting Coolify', async () => {
    const repository = {
      findServiceByHost: vi.fn().mockResolvedValue({ id: 's1', status: 'active' }),
      findOldestOpenOverdueInvoice: vi.fn().mockResolvedValue(null),
    }
    const gate = new BillingAccessControlService(
      repository as never,
      {
        getBillingSettings: vi.fn().mockResolvedValue(settings),
      } as never,
    )
    await expect(gate.evaluate('app.example.test', 'secret')).resolves.toMatchObject({
      state: 'normal',
    })
  })

  it('ignores test overrides in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BILLING_GATE_TEST_HOST', 'app.example.test')
    vi.stubEnv('BILLING_GATE_TEST_STATE', 'paid')
    const repository = {
      findServiceByHost: vi.fn().mockResolvedValue({ id: 's1', status: 'suspended' }),
    }
    const gate = new BillingAccessControlService(
      repository as never,
      {
        getBillingSettings: vi.fn().mockResolvedValue(settings),
      } as never,
    )
    await expect(gate.evaluate('app.example.test', 'secret')).resolves.toMatchObject({
      state: 'suspended',
    })
  })
})
