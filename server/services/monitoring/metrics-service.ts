import { and, count, eq, inArray, lt } from 'drizzle-orm'
import { useDatabase, type Database } from '../../database/client'
import {
  emailDeliveries,
  infrastructureBackupPolicies,
  infrastructureDatabaseBackups,
  infrastructureNodes,
  infrastructureOperations,
  invoices,
  jobRuns,
  services,
} from '../../database/schema'

export class MetricsService {
  constructor(private readonly database: Database = useDatabase()) {}

  async renderPrometheus() {
    const stuckMinutes = Number(useRuntimeConfig().operationStuckMinutes || 15)
    const stuckBefore = new Date(Date.now() - stuckMinutes * 60_000)
    const [invoiceRows, serviceRows, failedEmails, failedJobs, nodes, stuckOperations, backupRows, overduePolicies] = await Promise.all([
      this.database
        .select({ status: invoices.status, total: count() })
        .from(invoices)
        .groupBy(invoices.status),
      this.database
        .select({ status: services.status, total: count() })
        .from(services)
        .groupBy(services.status),
      this.database
        .select({ total: count() })
        .from(emailDeliveries)
        .where(eq(emailDeliveries.status, 'failed')),
      this.database.select({ total: count() }).from(jobRuns).where(eq(jobRuns.status, 'failed')),
      this.database.select({
        id: infrastructureNodes.id,
        name: infrastructureNodes.name,
        environment: infrastructureNodes.environment,
        status: infrastructureNodes.status,
        isActive: infrastructureNodes.isActive,
        lastHeartbeatAt: infrastructureNodes.lastHeartbeatAt,
        cpuUsageBasisPoints: infrastructureNodes.cpuUsageBasisPoints,
        capacityMemoryBytes: infrastructureNodes.capacityMemoryBytes,
        memoryUsedBytes: infrastructureNodes.memoryUsedBytes,
        diskUsageBasisPoints: infrastructureNodes.diskUsageBasisPoints,
      }).from(infrastructureNodes),
      this.database.select({ nodeId: infrastructureOperations.nodeId })
        .from(infrastructureOperations)
        .where(and(
          inArray(infrastructureOperations.status, ['queued', 'dispatched', 'running']),
          lt(infrastructureOperations.createdAt, stuckBefore),
        )),
      this.database
        .select({ status: infrastructureDatabaseBackups.status, total: count() })
        .from(infrastructureDatabaseBackups)
        .groupBy(infrastructureDatabaseBackups.status),
      this.database
        .select({ total: count() })
        .from(infrastructureBackupPolicies)
        .where(and(
          eq(infrastructureBackupPolicies.isActive, true),
          lt(infrastructureBackupPolicies.nextRunAt, new Date()),
        )),
    ])
    const stuckByNode = new Map<string, number>()
    for (const operation of stuckOperations) {
      stuckByNode.set(operation.nodeId, (stuckByNode.get(operation.nodeId) ?? 0) + 1)
    }
    const now = Date.now()
    const nodeLines = nodes.flatMap((node) => {
      const labels = `node_id="${metricLabel(node.id)}",name="${metricLabel(node.name)}",environment="${metricLabel(node.environment)}"`
      const heartbeatAge = node.lastHeartbeatAt
        ? Math.max(0, (now - node.lastHeartbeatAt.getTime()) / 1000)
        : -1
      const up = node.isActive && node.status !== 'revoked' && heartbeatAge >= 0 && heartbeatAge < 90 ? 1 : 0
      const memoryRatio = node.capacityMemoryBytes && node.memoryUsedBytes
        ? Number(node.memoryUsedBytes) / Number(node.capacityMemoryBytes)
        : 0
      return [
        `oc_node_up{${labels}} ${up}`,
        `oc_node_heartbeat_age_seconds{${labels}} ${heartbeatAge}`,
        `oc_node_cpu_usage_ratio{${labels}} ${(node.cpuUsageBasisPoints ?? 0) / 10_000}`,
        `oc_node_memory_usage_ratio{${labels}} ${Number.isFinite(memoryRatio) ? memoryRatio : 0}`,
        `oc_node_disk_usage_ratio{${labels}} ${(node.diskUsageBasisPoints ?? 0) / 10_000}`,
        `oc_node_stuck_operations{${labels}} ${stuckByNode.get(node.id) ?? 0}`,
      ]
    })
    const pool = this.database.$client
    const lines = [
      '# HELP billengine_up Whether the application can query PostgreSQL.',
      '# TYPE billengine_up gauge',
      'billengine_up 1',
      '# HELP billengine_invoices_total Invoices grouped by status.',
      '# TYPE billengine_invoices_total gauge',
      ...invoiceRows.map(
        (row) => `billengine_invoices_total{status="${row.status}"} ${Number(row.total)}`,
      ),
      '# HELP billengine_services_total Services grouped by status.',
      '# TYPE billengine_services_total gauge',
      ...serviceRows.map(
        (row) => `billengine_services_total{status="${row.status}"} ${Number(row.total)}`,
      ),
      '# HELP billengine_email_failures_total Current failed email delivery records.',
      '# TYPE billengine_email_failures_total gauge',
      `billengine_email_failures_total ${Number(failedEmails[0]?.total ?? 0)}`,
      '# HELP billengine_job_failures_total Current failed job run records.',
      '# TYPE billengine_job_failures_total gauge',
      `billengine_job_failures_total ${Number(failedJobs[0]?.total ?? 0)}`,
      '# HELP billengine_db_pool_connections PostgreSQL pool connections by state.',
      '# TYPE billengine_db_pool_connections gauge',
      `billengine_db_pool_connections{state="total"} ${pool.totalCount}`,
      `billengine_db_pool_connections{state="idle"} ${pool.idleCount}`,
      `billengine_db_pool_connections{state="waiting"} ${pool.waitingCount}`,
      '# HELP oc_node_up Whether the OC Agent heartbeat is fresh.',
      '# TYPE oc_node_up gauge',
      '# HELP oc_node_heartbeat_age_seconds Seconds since the latest agent heartbeat; -1 means never.',
      '# TYPE oc_node_heartbeat_age_seconds gauge',
      '# HELP oc_node_cpu_usage_ratio Latest node CPU usage ratio.',
      '# TYPE oc_node_cpu_usage_ratio gauge',
      '# HELP oc_node_memory_usage_ratio Latest node memory usage ratio.',
      '# TYPE oc_node_memory_usage_ratio gauge',
      '# HELP oc_node_disk_usage_ratio Latest root disk usage ratio.',
      '# TYPE oc_node_disk_usage_ratio gauge',
      '# HELP oc_node_stuck_operations Active operations older than the configured threshold.',
      '# TYPE oc_node_stuck_operations gauge',
      ...nodeLines,
      '# HELP oc_backup_runs_total Backup runs grouped by current status.',
      '# TYPE oc_backup_runs_total gauge',
      ...backupRows.map(
        (row) => `oc_backup_runs_total{status="${metricLabel(row.status)}"} ${Number(row.total)}`,
      ),
      '# HELP oc_backup_policies_overdue Active backup policies whose next run is overdue.',
      '# TYPE oc_backup_policies_overdue gauge',
      `oc_backup_policies_overdue ${Number(overduePolicies[0]?.total ?? 0)}`,
    ]

    return lines.join('\n') + '\n'
  }
}

function metricLabel(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
}
