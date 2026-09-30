import { desc, eq } from 'drizzle-orm'
import { useDatabase, type Database, type Transaction } from '../database/client'
import { auditLogs, jobRuns } from '../database/schema'

export interface AuditEntryInput {
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string | null
  beforeData?: unknown
  afterData?: unknown
  metadata?: unknown
  ipAddress?: string | null
  userAgent?: string | null
}

export class AuditLogRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  /**
   * Audit writes are meaningful only if they commit with the change they
   * describe, so callers pass their transaction handle.
   */
  async record(transaction: Transaction, entry: AuditEntryInput) {
    await transaction.insert(auditLogs).values({
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeData: toAuditJson(entry.beforeData),
      afterData: toAuditJson(entry.afterData),
      metadata: toAuditJson(entry.metadata),
      ipAddress: normalizeIpAddress(entry.ipAddress),
      userAgent: entry.userAgent ?? null,
    })
  }
}

/**
 * PostgreSQL bigint values are native BigInt objects in Drizzle, while JSONB
 * only accepts JSON-compatible values. Audit data is a snapshot, so preserving
 * exact integers as decimal strings is safer than coercing them to Number.
 */
export function toAuditJson(value: unknown): unknown {
  if (value === undefined || value === null) return null
  return JSON.parse(
    JSON.stringify(value, (_key, entry) => (typeof entry === 'bigint' ? entry.toString() : entry)),
  ) as unknown
}

/** The `inet` column rejects arbitrary strings, so drop anything unusable. */
function normalizeIpAddress(value: string | null | undefined): string | null {
  if (!value) return null
  const candidate = value.split(',')[0]?.trim() ?? ''
  return candidate && /^[0-9a-fA-F.:]+$/.test(candidate) ? candidate : null
}

export interface JobRunInput {
  jobName: string
  status: 'running' | 'completed' | 'failed'
  startedAt: Date
  finishedAt?: Date | null
  processedCount?: number
  errorMessage?: string | null
  metadata?: unknown
}

export class JobRunRepository {
  constructor(private readonly database: Database = useDatabase()) {}

  async start(jobName: string) {
    const [created] = await this.database
      .insert(jobRuns)
      .values({ jobName, status: 'running', startedAt: new Date() })
      .returning()

    if (!created) throw new Error('Failed to start job run.')
    return created
  }

  async finish(
    id: string,
    result: {
      status: 'completed' | 'failed'
      processedCount?: number
      errorMessage?: string | null
      metadata?: unknown
    },
  ) {
    await this.database
      .update(jobRuns)
      .set({
        status: result.status,
        finishedAt: new Date(),
        processedCount: result.processedCount ?? 0,
        errorMessage: result.errorMessage ?? null,
        metadata: toAuditJson(result.metadata),
      })
      .where(eq(jobRuns.id, id))
  }

  async findById(id: string) {
    const [row] = await this.database.select().from(jobRuns).where(eq(jobRuns.id, id)).limit(1)
    return row ?? null
  }

  async listRecent(limit: number) {
    return this.database.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(limit)
  }
}
