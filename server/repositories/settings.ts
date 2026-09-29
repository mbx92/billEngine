import { eq } from 'drizzle-orm'
import { useDatabase, type Database, type Transaction } from '../database/client'
import { settings } from '../database/schema'

export const BILLING_SETTINGS_KEY = 'billing.configuration'

export class SettingsRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async findByKey(key: string) {
    const [row] = await this.database.select().from(settings).where(eq(settings.key, key)).limit(1)
    return row ?? null
  }

  async upsert(transaction: Transaction, key: string, value: unknown) {
    const [row] = await transaction
      .insert(settings)
      .values({ key, value, isSecret: false })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, isSecret: false, updatedAt: new Date() },
      })
      .returning()

    if (!row) throw new Error('Failed to save settings.')
    return row
  }
}
