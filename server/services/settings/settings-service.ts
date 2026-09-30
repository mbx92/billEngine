import type { ApiBillingSettings } from '../../../shared/types/api'
import {
  updateBillingSettingsSchema,
  type UpdateBillingSettingsInput,
} from '../../../shared/schemas/settings'
import { useDatabase, type Database } from '../../database/client'
import { AuditLogRepository } from '../../repositories/audit'
import { BILLING_SETTINGS_KEY, SettingsRepository } from '../../repositories/settings'

export interface SettingsActorContext {
  userId: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export class SettingsService {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly settings = new SettingsRepository(database),
    private readonly audit = new AuditLogRepository(database),
  ) {}

  async getBillingSettings(): Promise<ApiBillingSettings> {
    const fallback = environmentSettings()
    const row = await this.settings.findByKey(BILLING_SETTINGS_KEY)
    if (!row) return fallback

    const parsed = updateBillingSettingsSchema.safeParse(row.value)
    if (!parsed.success) return fallback

    return {
      ...parsed.data,
      source: 'database',
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  async updateBillingSettings(input: UpdateBillingSettingsInput, actor: SettingsActorContext) {
    const before = await this.getBillingSettings()

    return this.database.transaction(async (transaction) => {
      const row = await this.settings.upsert(transaction, BILLING_SETTINGS_KEY, input)
      const after: ApiBillingSettings = {
        ...input,
        source: 'database',
        updatedAt: row.updatedAt.toISOString(),
      }

      await this.audit.record(transaction, {
        actorUserId: actor.userId,
        action: 'settings.updated',
        entityType: 'settings',
        entityId: row.id,
        beforeData: before,
        afterData: after,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      })

      return after
    })
  }
}

function environmentSettings(): ApiBillingSettings {
  const config = useRuntimeConfig()
  return {
    companyName: config.companyName || 'Billing Infra',
    companyEmail: config.companyEmail || null,
    companyAddress: config.companyAddress || null,
    companyTaxId: config.companyTaxId || null,
    billingTimezone: config.billingTimezone || 'UTC',
    billingCurrency: config.billingCurrency || 'IDR',
    defaultTaxRate: config.billingDefaultTaxRate || null,
    billingAutomationEnabled: config.billingAutomationEnabled === true,
    billingAccessControlEnabled: config.billingAccessControlEnabled === true,
    overdueGraceDays: Number(config.overdueGraceDays ?? 7),
    graceNoticeIntervalHours: Number(config.graceNoticeIntervalHours ?? 24),
    source: 'environment',
    updatedAt: null,
  }
}
