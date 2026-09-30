import { BillingAccessRepository } from '../../repositories/billing-access'
import { todayIsoDate } from '../../utils/clock'
import { SettingsService } from '../settings/settings-service'
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
