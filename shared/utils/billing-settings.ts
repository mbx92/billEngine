import type { ApiBillingSettings } from '../types/api'
import {
  updateBillingSettingsSchema,
  type UpdateBillingSettingsInput,
} from '../schemas/settings'

type BillingSettingsFields = Omit<ApiBillingSettings, 'source' | 'updatedAt'>

export function overlayStoredBillingSettings(
  fallback: ApiBillingSettings,
  stored: unknown,
  updatedAt: Date | string | null,
): ApiBillingSettings {
  const parsed = updateBillingSettingsSchema.safeParse(stored)
  if (parsed.success) {
    return withDatabaseSource(applyDeploymentOverrides(fallback, parsed.data), updatedAt)
  }

  const overlay = pickValidBillingSettings(stored)
  if (Object.keys(overlay).length === 0) return fallback

  return withDatabaseSource(
    applyDeploymentOverrides(fallback, { ...fallback, ...overlay }),
    updatedAt,
  )
}

export function pickValidBillingSettings(stored: unknown): Partial<UpdateBillingSettingsInput> {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}

  const record = stored as Record<string, unknown>
  const picked: Partial<UpdateBillingSettingsInput> = {}

  for (const key of Object.keys(updateBillingSettingsSchema.shape) as Array<
    keyof typeof updateBillingSettingsSchema.shape
  >) {
    if (!Object.hasOwn(record, key)) continue
    const result = updateBillingSettingsSchema.shape[key].safeParse(record[key])
    if (result.success) {
      Object.assign(picked, { [key]: result.data })
    }
  }

  return picked
}

function applyDeploymentOverrides(
  fallback: BillingSettingsFields,
  stored: BillingSettingsFields,
): BillingSettingsFields {
  return {
    ...stored,
    billingAutomationEnabled: fallback.billingAutomationEnabled || stored.billingAutomationEnabled,
    billingAccessControlEnabled:
      fallback.billingAccessControlEnabled || stored.billingAccessControlEnabled,
  }
}

function withDatabaseSource(
  settings: BillingSettingsFields,
  updatedAt: Date | string | null,
): ApiBillingSettings {
  return {
    ...settings,
    source: 'database',
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  }
}
