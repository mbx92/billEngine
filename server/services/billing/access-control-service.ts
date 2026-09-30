import { BillingAccessRepository } from '../../repositories/billing-access'
import { todayIsoDate } from '../../utils/clock'
import { SettingsService } from '../settings/settings-service'
import { addDays } from './cycles'
import { invoiceFingerprint } from './gate-token'
import { overdueAccessWindow } from './access-policy'

export interface BillingAccessDecision {
  state: 'normal' | 'grace' | 'blocked'
  service: {
    id: string
    name: string
    serviceNumber: string
  } | null
  invoice: {
    id: string
    invoiceNumber: string
    dueDate: string
    fingerprint: string
  } | null
  daysPastDue: number
  graceEndsAt: string | null
  noticeIntervalHours: number
}

export class BillingAccessControlService {
  constructor(
    private readonly repository = new BillingAccessRepository(),
    private readonly settings = new SettingsService(),
  ) {}

  async evaluate(host: string, secret: string, asOf?: string): Promise<BillingAccessDecision> {
    const testDecision = billingGateTestDecision(host, secret, asOf)
    if (testDecision) return testDecision

    const settings = await this.settings.getBillingSettings()
    const normal = (): BillingAccessDecision => ({
      state: 'normal',
      service: null,
      invoice: null,
      daysPastDue: 0,
      graceEndsAt: null,
      noticeIntervalHours: settings.graceNoticeIntervalHours,
    })

    if (!settings.billingAccessControlEnabled) return normal()

    const service = await this.repository.findServiceByHost(host)
    if (!service) return normal()

    const effectiveDate = asOf ?? todayIsoDate(settings.billingTimezone)
    const invoice = await this.repository.findOldestOpenOverdueInvoice(service.id, effectiveDate)
    if (!invoice) return normal()

    const window = overdueAccessWindow(invoice.dueDate, effectiveDate, settings.overdueGraceDays)
    if (!window) return normal()

    return {
      state: window.state,
      service: {
        id: service.id,
        name: service.name,
        serviceNumber: service.serviceNumber,
      },
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        dueDate: invoice.dueDate,
        fingerprint: invoiceFingerprint(invoice.id, secret),
      },
      daysPastDue: window.daysPastDue,
      graceEndsAt: window.graceEndsAt,
      noticeIntervalHours: settings.graceNoticeIntervalHours,
    }
  }
}

function billingGateTestDecision(
  host: string,
  secret: string,
  asOf?: string,
): BillingAccessDecision | null {
  const testHost = process.env.BILLING_GATE_TEST_HOST?.trim().toLowerCase()
  const testState = process.env.BILLING_GATE_TEST_STATE
  if (!testHost || host.toLowerCase() !== testHost) return null
  if (!testState || !['normal', 'paid', 'grace', 'blocked'].includes(testState)) return null

  const noticeIntervalHours = Number(process.env.GRACE_NOTICE_INTERVAL_HOURS || 24)
  const normal = (): BillingAccessDecision => ({
    state: 'normal',
    service: null,
    invoice: null,
    daysPastDue: 0,
    graceEndsAt: null,
    noticeIntervalHours,
  })
  if (testState === 'normal' || testState === 'paid') return normal()

  const effectiveDate = asOf ?? todayIsoDate(process.env.BILLING_TIMEZONE || 'Asia/Makassar')
  const accessState = testState === 'blocked' ? 'blocked' : 'grace'
  const daysPastDue = accessState === 'blocked' ? 10 : 1
  const dueDate = addDays(effectiveDate, -daysPastDue)
  const invoiceId = '10000000-0000-4000-8000-000000000006'

  return {
    state: accessState,
    service: {
      id: '10000000-0000-4000-8000-000000000004',
      name: 'OpsWiki Hosting',
      serviceNumber: 'SVC-GATE-TEST',
    },
    invoice: {
      id: invoiceId,
      invoiceNumber: 'INV-GATE-TEST',
      dueDate,
      fingerprint: invoiceFingerprint(invoiceId, secret),
    },
    daysPastDue,
    graceEndsAt: addDays(dueDate, 7),
    noticeIntervalHours,
  }
}
