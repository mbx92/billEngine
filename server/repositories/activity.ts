import { count, desc, eq } from 'drizzle-orm'
import type { ApiActivityEntry } from '../../shared/types/api'
import { useDatabase, type Database } from '../database/client'
import { auditLogs, users } from '../database/schema'
import { JobRunRepository } from './audit'

export class ActivityRepository {
  constructor(
    private readonly database: Database = useDatabase(),
    private readonly jobRuns = new JobRunRepository(database),
  ) {}

  async listAuditLogs(page: number, perPage: number) {
    const offset = (page - 1) * perPage
    const [rows, totals] = await Promise.all([
      this.database
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          actorName: users.name,
          actorEmail: users.email,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(perPage)
        .offset(offset),
      this.database.select({ total: count() }).from(auditLogs),
    ])

    const data: ApiActivityEntry[] = rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actorName: row.actorName,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt.toISOString(),
    }))

    return { rows: data, total: totals[0]?.total ?? 0 }
  }

  listJobRuns(limit: number) {
    return this.jobRuns.listRecent(limit)
  }
}
