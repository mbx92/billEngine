import { count, eq } from 'drizzle-orm'
import { useDatabase, type Database } from '../../database/client'
import { emailDeliveries, invoices, jobRuns, services } from '../../database/schema'

export class MetricsService {
  constructor(private readonly database: Database = useDatabase()) {}

  async renderPrometheus() {
    const [invoiceRows, serviceRows, failedEmails, failedJobs] = await Promise.all([
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
    ])
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
    ]

    return lines.join('\n') + '\n'
  }
}
